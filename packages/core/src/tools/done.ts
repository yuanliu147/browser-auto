import { z } from "zod";
import type { Tool } from "../loop/types.js";

export function createSubmitDoneTool(): Tool {
  return {
    name: "submitDone",
    description:
      "Mark the current task as complete and submit the result. Call this exactly once when you have finished the task.",
    parameters: z.object({
      result: z
        .unknown()
        .optional()
        .describe("Optional result data for the caller"),
    }),
    execute: async ({ result }, _context) => {
      return { done: true, result };
    },
  };
}
