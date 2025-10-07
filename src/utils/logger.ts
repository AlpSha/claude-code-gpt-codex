import { Logger } from "../types";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  const payload = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const timestamp = new Date().toISOString();
  const formatted = `[codex:${level}] ${timestamp} ${message}${payload}`;
  switch (level) {
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export function createLogger(enabled: boolean): Logger {
  if (!enabled) {
    const noop = () => {
      /* intentional no-op */
    };
    return {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    };
  }

  return {
    debug(message, meta) {
      emit("debug", message, meta);
    },
    info(message, meta) {
      emit("info", message, meta);
    },
    warn(message, meta) {
      emit("warn", message, meta);
    },
    error(message, meta) {
      if (message instanceof Error) {
        emit("error", message.message, {
          ...(meta ?? {}),
          stack: message.stack,
          name: message.name,
        });
      } else {
        emit("error", message, meta);
      }
    },
  };
}

export type LoggerLike = ReturnType<typeof createLogger>;

export function maskToken(value?: string): string | undefined {
  if (!value) {
    return value;
  }
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
