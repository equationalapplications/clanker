import { FunctionTool } from '@google/adk';
import { getCurrentTimeManifest } from '@equationalapplications/core-llm-tools';

export const getCurrentTimeTool = new FunctionTool({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...(getCurrentTimeManifest.schema as any),
  execute: async (): Promise<string> => {
    return new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  },
});
