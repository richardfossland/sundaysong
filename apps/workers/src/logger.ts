import type { Logger } from "@sundaysong/connectors";

/** One-line JSON logs — greppable, and ready for any log aggregator. */
export const jsonLogger: Logger = {
  info: (message, meta) => emit("info", message, meta),
  warn: (message, meta) => emit("warn", message, meta),
  error: (message, meta) => emit("error", message, meta),
};

function emit(level: string, message: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }));
}
