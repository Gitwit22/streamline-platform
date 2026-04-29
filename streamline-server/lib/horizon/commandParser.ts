/**
 * Horizon command trigger parser.
 *
 * Detects whether a message contains a Horizon-directed command,
 * extracts the cleaned command text, and identifies mentions.
 */

export interface CommandTriggerConfig {
  /** Phrases that indicate a Horizon-directed command. */
  commandTriggers: string[];
  /** Strip the matched trigger from the command text. */
  extractCommand: boolean;
  /** Mark the payload as command-like when a trigger matches. */
  parseIntent: boolean;
  /** How Horizon should respond (e.g. "chat"). */
  responseMode: "chat" | "voice" | "silent";
}

export const DEFAULT_TRIGGER_CONFIG: CommandTriggerConfig = {
  commandTriggers: ["@horizon", "horizon:", "hey horizon"],
  extractCommand: true,
  parseIntent: true,
  responseMode: "chat",
};

export interface ParsedCommand {
  /** Whether a Horizon trigger was detected. */
  isCommand: boolean;
  /** The trigger phrase that matched (or null). */
  matchedTrigger: string | null;
  /** Cleaned command text with trigger stripped (when extractCommand=true). */
  commandText: string;
  /** The original raw message preserved for debugging. */
  originalText: string;
  /** Extracted @mentions from the message body. */
  mentions: string[];
}

/**
 * Parse a chat message for Horizon command triggers and @mentions.
 */
export function parseCommand(
  rawMessage: string,
  config: CommandTriggerConfig = DEFAULT_TRIGGER_CONFIG,
): ParsedCommand {
  const originalText = rawMessage;
  const lower = rawMessage.toLowerCase().trim();

  // Detect mentions: words starting with @
  const mentionRe = /@(\w+)/g;
  const mentions: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = mentionRe.exec(rawMessage)) !== null) {
    mentions.push(m[1].toLowerCase());
  }

  // Check triggers (longest-first to avoid partial matches)
  const sorted = [...config.commandTriggers].sort((a, b) => b.length - a.length);
  let matchedTrigger: string | null = null;

  for (const trigger of sorted) {
    const idx = lower.indexOf(trigger.toLowerCase());
    if (idx !== -1) {
      matchedTrigger = trigger;
      break;
    }
  }

  const isCommand = config.parseIntent ? !!matchedTrigger : false;

  let commandText = rawMessage.trim();
  if (matchedTrigger && config.extractCommand) {
    // Remove the matched trigger (case-insensitive) and trim leftover whitespace / punctuation.
    const re = new RegExp(escapeRegExp(matchedTrigger), "i");
    commandText = rawMessage.replace(re, "").replace(/^[\s,.:!?]+/, "").trim();
  }

  return { isCommand, matchedTrigger, commandText, originalText, mentions };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
