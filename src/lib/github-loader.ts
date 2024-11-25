import { db } from "@/server/db";
import { GithubRepoLoader } from "@langchain/community/document_loaders/web/github";
import { type Document } from "@langchain/core/documents";
import { generateEmbedding, summariseCode } from "./gemini";

export const loadGithubRepo = async (
  githubUrl: string,
  githubToken?: string,
) => {
  if (!githubToken) {
    console.warn(
      "Warning: No GitHub token provided. This will subject you to stricter API rate limits.",
    );
  }

  // Implement exponential backoff retry logic
  const retry = async (fn: () => Promise<any>, maxAttempts = 3) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        if (attempt === maxAttempts) throw error;

        if (error.message.includes("rate limit exceeded")) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(
            `Rate limit hit. Waiting ${waitTime / 1000} seconds before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          throw error;
        }
      }
    }
  };

  try {
    const loader = new GithubRepoLoader(githubUrl, {
      accessToken: githubToken,
      branch: "main",
      ignoreFiles: [
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lockb",
        ".git",
        "node_modules",
        "dist",
        "build",
      ],
      recursive: true,
      unknown: "warn",
      maxConcurrency: 2, // Reduced to avoid hitting rate limits too quickly
    });

    return await retry(async () => {
      const docs = await loader.load();
      console.log(
        `Successfully loaded ${docs.length} documents from ${githubUrl}`,
      );
      return docs;
    });
  } catch (error: any) {
    if (error.message.includes("rate limit exceeded")) {
      throw new Error(
        `GitHub API rate limit exceeded. To increase your rate limit, please provide a GitHub token. ` +
          `You can create one at https://github.com/settings/tokens`,
      );
    }
    throw error;
  }
};

export const indexGithubRepo = async (
  projectId: string,
  githubUrl: string,
  githubToken?: string,
) => {
  const docs = await loadGithubRepo(githubUrl, githubToken);
  const allEmbeddings = await generateEmbeddings(docs);
  await Promise.allSettled(
    allEmbeddings.map(async (embedding, index) => {
      console.log(`Processing ${index} of ${allEmbeddings.length}`);
      if (!embedding) {
        return;
      }
      const sourceCodeEmbedding = await db.sourceCodeEmbedding.create({
        data: {
          summary: embedding.summary,
          sourceCode: embedding.sourceCode,
          fileName: embedding.fileName,
          projectId,
        },
      });
      await db.$executeRaw`
      UPDATE "SourceCodeEmbedding"
      SET "summaryEmbedding" = ${embedding.embedding}::vector
      WHERE "id" = ${sourceCodeEmbedding.id}
      `;
    }),
  );
};

const generateEmbeddings = async (docs: Document[]) => {
  return await Promise.all(
    docs.map(async (doc) => {
      const summary = await summariseCode(doc);
      const embedding = await generateEmbedding(summary);
      return {
        summary,
        embedding,
        sourceCode: JSON.parse(JSON.stringify(doc.pageContent)),
        fileName: doc.metadata.source,
      };
    }),
  );
};
