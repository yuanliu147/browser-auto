import { tool } from "ai";
import { z } from "zod";

export function createSubmitDoneTool() {
  return tool({
    description:
      "Mark the current task as complete and submit the result. Call this exactly once when you have finished the task.",
    inputSchema: z.object({
      result: z
        .unknown()
        .optional()
        .describe("Optional result data for the caller"),
    }),
    execute: async ({ result }) => {
      return { done: true, result };
    },
  });
}
