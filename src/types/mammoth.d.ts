declare module "mammoth" {
  interface Result {
    value: string;
    messages: unknown[];
  }
  function extractRawText(options: { buffer: Buffer }): Promise<Result>;
}
