import { db } from "@/server/db";
import axios from "axios";
import { Octokit } from "octokit";
import pLimit from "p-limit";
import { aiSummarizeCommit } from "./gemini";

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Rate limiting configuration
const RETRY_DELAYS = [1000, 2000, 4000, 8000];
const MAX_CONCURRENT = 5;
const limit = pLimit(MAX_CONCURRENT);

type Response = {
  commitHash: string;
  commitMessage: string;
  commitAuthorName: string;
  commitAuthorAvatar: string;
  commitDate: string;
};

// Retry wrapper function
async function withRetry<T>(fn: () => Promise<T>, retryCount = 0): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (error?.status === 429 && retryCount < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(
        `Rate limited. Waiting ${delay}ms before retry ${retryCount + 1}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(fn, retryCount + 1);
    }
    throw error;
  }
}

// Modified summarizeCommit with rate limiting
async function summariesCommit(githubUrl: string, commitHash: string) {
  return withRetry(async () => {
    try {
      const { data } = await axios.get(
        `${githubUrl}/commit/${commitHash}.diff`,
        {
          headers: {
            Accept: "application/vnd.github.v3.diff",
          },
        },
      );

      if (!data) {
        throw new Error("No diff data received");
      }

      const summary = await aiSummarizeCommit(data);
      if (!summary) {
        return "No summary available";
      }

      return summary;
    } catch (error) {
      console.error(`Error getting commit summary for ${commitHash}:`, error);
      return "Error generating summary";
    }
  });
}

export const pollCommits = async (projectId: string) => {
  try {
    const { githubUrl } = await fetchProjectGithubUrl(projectId);
    const commitHashes = await getCommitHashes(githubUrl);
    const unprocessedCommits = await filterUnprocessedCommits(
      projectId,
      commitHashes,
    );

    if (unprocessedCommits.length === 0) {
      console.log("No new commits to process");
      return [];
    }

    console.log(`Processing ${unprocessedCommits.length} commits...`);

    // Process commits with rate limiting
    const summaryResponses = await Promise.all(
      unprocessedCommits.map((commit) =>
        limit(async () => {
          try {
            const summary = await summariesCommit(githubUrl, commit.commitHash);
            console.log(`Successfully processed commit ${commit.commitHash}`);
            return {
              ...commit,
              summary,
            };
          } catch (error) {
            console.error(
              `Failed to process commit ${commit.commitHash}:`,
              error,
            );
            return null;
          }
        }),
      ),
    );

    // Filter out failed summaries
    const validSummaries = summaryResponses.filter(
      (summary): summary is NonNullable<typeof summary> => summary !== null,
    );

    // Process in smaller batches
    const batchSize = 3;
    const results = [];

    for (let i = 0; i < validSummaries.length; i += batchSize) {
      const batch = validSummaries.slice(i, i + batchSize);

      // Create commits one at a time to avoid database issues
      for (const summary of batch) {
        try {
          const commit = await db.commit.create({
            data: {
              projectId,
              commitHash: summary.commitHash,
              commitMessage: summary.commitMessage,
              commitAuthorName: summary.commitAuthorName,
              commitAuthorAvatar: summary.commitAuthorAvatar,
              commitDate: new Date(summary.commitDate),
              summary: summary.summary,
            },
          });
          results.push(commit);
          console.log(`Stored commit ${commit.commitHash}`);
        } catch (error) {
          console.error(`Failed to store commit ${summary.commitHash}:`, error);
        }
      }

      // Add a small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  } catch (error) {
    console.error("Error in pollCommits:", error);
    throw error;
  }
};

// Modified getCommitHashes with retry logic
export const getCommitHashes = async (
  githubUrl: string,
): Promise<Response[]> => {
  return withRetry(async () => {
    const [owner, repo] = githubUrl.split("/").slice(-2);
    if (!owner || !repo) {
      throw new Error("Invalid GitHub URL");
    }

    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 10,
    });

    const sortedCommits = data.sort(
      (a, b) =>
        new Date(b.commit.author?.date ?? 0).getTime() -
        new Date(a.commit.author?.date ?? 0).getTime(),
    );

    return sortedCommits.map((commit) => ({
      commitHash: commit.sha,
      commitMessage: commit.commit.message ?? "",
      commitAuthorName: commit.commit?.author?.name ?? "",
      commitAuthorAvatar: commit?.author?.avatar_url ?? "",
      commitDate: commit.commit?.author?.date ?? "",
    }));
  });
};

async function fetchProjectGithubUrl(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      githubUrl: true,
    },
  });

  if (!project) {
    throw new Error(`Project with ID ${projectId} not found.`);
  }

  return { githubUrl: project.githubUrl };
}

async function filterUnprocessedCommits(
  projectId: string,
  commitHashes: Response[],
) {
  const processedCommits = await db.commit.findMany({
    where: { projectId },
    select: { commitHash: true },
  });

  const processedHashes = new Set(
    processedCommits.map((commit) => commit.commitHash),
  );
  return commitHashes.filter(
    (commit) => !processedHashes.has(commit.commitHash),
  );
}
