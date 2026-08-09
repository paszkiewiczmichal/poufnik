export function renderPrompt(body: string, anonymizedText: string): string {
  return body.split("{{DOKUMENT}}").join(anonymizedText);
}
