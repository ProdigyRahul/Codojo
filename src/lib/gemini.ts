import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Document } from "@langchain/core/documents";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

export const aiSummarizeCommit = async (diff: string) => {
  const prompt = `You are an expert programmer analyzing a git diff for summarization.

Git Diff Format Guide:
1. File Metadata Format:
   Example metadata block:
   diff --git a/lib/index.js b/lib/index.js
   index aadf091..bfef003 100644
   --- a/lib/index.js
   +++ b/lib/index.js

   This indicates that 'lib/index.js' was modified. (This is just an example)

2. Line Modification Indicators:
   - Lines starting with '+': Added content
   - Lines starting with '-': Removed content
   - Lines without '+' or '-': Contextual code (not part of changes)

Output Format:
- Write concise, clear summaries of the changes
- Include relevant filenames in [square brackets] when mentioning 2 files or fewer
- Omit filenames if more than 2 files were modified for that change
- Focus on the actual changes, not the context lines

Example Summary Format:
- "Increased max recordings limit from 10 to 100 [packages/server/recordings_api.ts], [packages/server/constants.ts]"
- "Fixed GitHub action name typo [.github/workflows/gpt-commit-summarizer.yml]"
- "Relocated octokit initialization [src/octokit.ts], [src/index.ts]"
- "Implemented OpenAI completions API [packages/utils/apis/openai.ts]"
- "Adjusted numeric tolerance in test suite" (multiple files affected)

Note: These examples are for format reference only. Please provide your own original summary based on the actual diff content.

Please summarize the following diff:

${diff}`;

  const response = await model.generateContent([prompt]);
  return response.response.text();
};

export async function summariseCode(doc: Document) {
  try {
    console.log("Getting Summary for", doc.metadata.source);
    const code = doc.pageContent.slice(0, 10000);
    const response = await model.generateContent([
      `You are an intelligent senior software engineer who specialized in onboarding junior software engineers onto projects`,
      `You are onboarding a junior software engineer and explaining to them the purpose of the ${doc.metadata.source} file
     Here is the code
     ---
     ${code}
     ---
     Give a summary no more than 100 words of the code above`,
    ]);
    return response.response.text();
  } catch (error) {
    console.error("Error generating summary", error);
    return "";
  }
}

export async function generateEmbedding(summary: string) {
  const model = genAI.getGenerativeModel({
    model: "text-embedding-004",
  });
  const result = await model.embedContent(summary);
  const embedding = result.embedding;
  return embedding.values;
}
