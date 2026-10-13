export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api" + path, init);
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ detail: "The server could not complete this request." }));
    throw Error(
      typeof body.detail === "string"
        ? body.detail
        : "Invalid request. Check the values and try again.",
    );
  }
  return response.json() as Promise<T>;
}
export const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
