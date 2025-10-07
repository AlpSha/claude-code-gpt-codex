import http from "http";

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export function waitForOAuthCallback(
  expectedState: string,
  options: { port?: number; timeoutMs?: number } = {},
): Promise<OAuthCallbackResult> {
  const { port = 1455, timeoutMs = 5 * 60_000 } = options;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing URL");
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.statusCode = 400;
        res.end("Missing code/state");
        return;
      }

      if (state !== expectedState) {
        res.statusCode = 400;
        res.end("State mismatch");
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><body><h1>Authentication complete</h1><p>You can close this window.</p></body></html>`);

      resolve({ code, state });
      setImmediate(() => server.close());
    });

    server.listen(port, () => {
      /* ready */
    });

    server.on("error", (error) => {
      reject(error);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timed out"));
    }, timeoutMs);

    server.on("close", () => {
      clearTimeout(timer);
    });
  });
}
