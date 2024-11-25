"use server";

import { generateEmbedding } from "@/lib/gemini";
import { db } from "@/server/db";
import {
  GoogleGenerativeAI,
  type GenerativeModel,
} from "@google/generative-ai";
import { createStreamableValue, type StreamableValue } from "ai/rsc";

// Types
interface SourceCodeResult {
  fileName: string;
  sourceCode: string;
  summary: string;
  similarity?: number;
}

interface QuestionResponse {
  output: StreamableValue;
  filesReferences: SourceCodeResult[];
}

// Constants
const SIMILARITY_THRESHOLD = 0.5;
const MAX_RESULTS = 10;
const MODEL_NAME = "gemini-1.5-flash";

// Initialize Google AI
const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Formats the context from source code results
 */
function formatContext(results: SourceCodeResult[]): string {
  return results
    .map(
      (doc) =>
        `source: ${doc.fileName}\ncode content: ${doc.sourceCode}\nsummary of file: ${doc.summary}\n\n`,
    )
    .join("");
}

/**
 * Generates the prompt for the AI model
 */
function generatePrompt(context: string, question: string): string {
  return `
    You are an AI code assistant who answers questions about the codebase. Your target audience is a technical intern.
    You are a powerful, human-like artificial intelligence with expert knowledge in coding.
    You are helpful, articulate, and provide detailed technical explanations.

    When answering questions about code or specific files, provide detailed, step-by-step instructions.

    START CONTEXT BLOCK
    ${context}
    END CONTEXT BLOCK

    START QUESTION
    ${question}
    END OF QUESTION

    Guidelines:
    - Only use information from the provided context
    - If the context doesn't contain the answer, respond with "I apologize, but I don't have enough information to answer this question"
    - Do not invent or assume information not present in the context
    - Use markdown syntax, including code snippets where appropriate
    - Provide detailed answers that leave no room for ambiguity
    `;
}

/**
 * Performs vector similarity search on the source code database
 */
async function performVectorSearch(
  queryVector: number[],
  projectId: string,
): Promise<SourceCodeResult[]> {
  const vectorQuery = `[${queryVector.join(",")}]`;

  try {
    return (await db.$queryRaw`
      SELECT
        "fileName",
        "sourceCode",
        "summary",
        1 - ("summaryEmbedding" <==> ${vectorQuery}::vector) AS similarity
      FROM "SourceCodeEmbedding"
      WHERE
        1 - ("summaryEmbedding" <==> ${vectorQuery}::vector) > ${SIMILARITY_THRESHOLD}
        AND "projectId" = ${projectId}
      ORDER BY similarity DESC
      LIMIT ${MAX_RESULTS};
    `) as SourceCodeResult[];
  } catch (error) {
    console.error("Vector search failed:", error);
    throw new Error("Failed to search codebase");
  }
}

/**
 * Streams text from the AI model
 */
async function streamText({
  model,
  prompt,
}: {
  model: GenerativeModel;
  prompt: string;
}) {
  try {
    const result = await model.generateContentStream(prompt);
    return {
      textStream: result.stream,
    };
  } catch (error) {
    console.error("Text streaming failed:", error);
    throw new Error("Failed to generate response");
  }
}

/**
 * Main function to handle questions about the codebase
 */
export async function askQuestion(
  question: string,
  projectId: string,
): Promise<QuestionResponse> {
  const stream = createStreamableValue();

  try {
    // Generate embedding for the question
    const queryVector = await generateEmbedding(question);

    // Perform vector search
    const searchResults = await performVectorSearch(queryVector, projectId);

    // Format context from search results
    const context = formatContext(searchResults);

    // Generate and stream response
    const model = googleAI.getGenerativeModel({ model: MODEL_NAME });
    const prompt = generatePrompt(context, question);

    // Start streaming response
    (async () => {
      try {
        const { textStream } = await streamText({ model, prompt });

        for await (const delta of textStream) {
          stream.update(delta);
        }

        stream.done();
      } catch (error) {
        stream.error(error as Error);
      }
    })();

    return {
      output: stream.value,
      filesReferences: searchResults,
    };
  } catch (error) {
    stream.error(error as Error);
    throw error;
  }
}
