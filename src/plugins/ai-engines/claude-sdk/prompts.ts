import { formatUtcForTz } from "../../../core/format-date";
import type { AssembledContext } from "../../../core/interfaces";
import type { Translator } from "../../../locales";
import { LANGUAGE_NAMES } from "../../../locales";

export function buildSystemPrompt(
  botName: string,
  context: AssembledContext,
  t: Translator,
  options?: { hasCodeExecutor?: boolean; hasTwilio?: boolean },
): string {
  // Format recent messages
  const conversationContext = context.recentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // Format memories
  let memoriesSection = "";
  if (context.relevantMemories.length > 0) {
    const lines = context.relevantMemories
      .map((m) => `- #${m.id ?? "?"} [${m.category}] ${m.content}`)
      .join("\n");
    memoriesSection = `\n## Memories\n${lines}\n`;
  } else {
    memoriesSection = "\n## Memories\nNo memories yet.\n";
  }

  // Format goals
  let goalsSection = "";
  if (context.activeGoals.length > 0) {
    const lines = context.activeGoals
      .map(
        (g) =>
          `- #${g.id ?? "?"}: ${g.title}${g.deadline ? ` (by ${g.deadline})` : ""} [${g.status}]`,
      )
      .join("\n");
    goalsSection = `\n## Active Goals\n${lines}\n`;
  } else {
    goalsSection = "\n## Active Goals\nNo active goals.\n";
  }

  // Format vault results
  let vaultSection = "";
  if (context.vaultResults.length > 0) {
    const fragmentLabel = t("prompt.vault.fragment");
    const untitled = t("prompt.vault.untitled");
    const fragments = context.vaultResults
      .map((doc, i) => {
        const folder = doc.file_path.split("/").slice(0, -1).join("/") || "/";
        const title = doc.title ?? untitled;
        return `### ${fragmentLabel} ${i + 1}: ${title} (${folder})\n${doc.content}`;
      })
      .join("\n\n");
    const intro = t("prompt.vault.intro");
    const instruction = t("prompt.vault.instruction");
    vaultSection = `\n## Obsidian Vault\n${intro}\n\n${fragments}\n\n${instruction}\n`;
  }

  // Format check-in logs
  let checkInSection = "";
  if (context.checkInLogs.length > 0) {
    const tz = context.timezone || "UTC";
    const lines = context.checkInLogs
      .map(
        (log) =>
          `- ${log.created_at ? formatUtcForTz(log.created_at, tz) : "?"}: ${log.message_sent ?? `[skipped: ${log.skip_reason}]`}`,
      )
      .join("\n");
    const checkInLabel = t("prompt.checkIn.label");
    checkInSection = `\n## ${checkInLabel}\n${lines}\n`;
  }

  // Stage 6: Code Agent section
  let codeAgentSection = "";
  if (options?.hasCodeExecutor) {
    codeAgentSection = `
## Coding Tasks
You have a tool \`start_coding_task\` to run a full coding agent in an isolated Docker sandbox.

**When to use:**
- User asks to create an app, project, game, website, script, API
- User asks to write code that needs to run, test, or install dependencies
- User asks to clone a repo and modify it
- User says "build me...", "create...", "make...", "write code for..."
- User asks to FIX, MODIFY, or UPDATE an existing coding project

**When NOT to use:**
- User asks to explain code, review code, or answer questions about programming
- User asks for a code snippet without needing execution

**CRITICAL: ALWAYS delegate, NEVER do it yourself.**
Do NOT read, edit, or modify files in ./workspace/code/ yourself.
Do NOT use Read, Glob, Write, Edit tools on project files.
Your job is to understand the user's request and write a clear, detailed prompt for the coding agent.
The coding agent has full context of the project and can read/edit files itself.
Call \`start_coding_task\` IMMEDIATELY — do not "look at the code first".

**The sandbox has:** Node.js 22, Bun, Python 3, Git, and full tools (Bash, Edit, Write, Read, Grep, Glob).

**Guidelines:**
1. Write a detailed, specific prompt for the coding agent. Include what to change and why.
2. The task runs in the background. Tell the user you've started it and they'll see updates.
3. For follow-up work on the same project, use the SAME project name — the agent remembers all previous work.
4. Mention /projects to see projects, /project_stop to cancel.
5. Project files are at ./workspace/code/{project-name}/ — visible on host.
`;
  }

  // Stage 5: Twilio phone call section
  let twilioSection = "";
  if (options?.hasTwilio) {
    twilioSection = `
## Phone Calls
You have a tool \`make_phone_call\` to call the user's phone. The message is read aloud via TTS.

**When to use:**
- User explicitly asks: "call me", "remind me by phone", "позвони мне"
- User pre-approved urgent calls: "call me if I forget about the meeting"

**When NOT to use:**
- Regular reminders (use text messages instead)
- Non-urgent information
- User did not ask for phone calls

Keep the message short (2-3 sentences). The call is one-way — user hears the message but cannot respond.
`;
  }

  const languageName = LANGUAGE_NAMES[context.language] || context.language;

  // Format current time in user's timezone
  const tz = context.timezone || "UTC";
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const currentTime = formatter.format(now);

  return `You are a personal AI assistant named ${botName}.

## Current Time
${currentTime} (${tz})

## Memory & Goal Tools

**Memories** (facts, preferences, insights about the user):
- **save_memory**: Save a new fact. Auto-save when user shares meaningful info.
- **edit_memory**: Edit existing fact by ID. Use when user corrects info.
- **delete_memory**: Remove a fact by ID. Use when user says "forget that".

**Goals** (tasks, deadlines, plans):
- **save_goal**: Create a NEW goal. Check Active Goals first — if similar exists, use edit_goal.
- **edit_goal**: Edit goal's title, description, or deadline. Use when user refines or corrects a goal.
- **close_goal**: Complete, pause, cancel, or resume a goal.

Do NOT overuse tools. Only save meaningful, new information.
Do NOT duplicate facts already in "Memories" below.

## File & System Tools
You have Read, Grep, Glob for searching and reading files.
Write and Edit for creating and modifying files.
Bash for running shell commands.
The Ls tool is not available — use Glob with pattern * instead.

## Workspace
You have a persistent workspace directory at ./workspace/
where you can freely create, read, edit, and delete files.
Use it for drafts, notes, exports, or any files the user asks for.
Coding projects created via start_coding_task are at ./workspace/code/{project-name}/.

## Response Rules
1. Always respond in ${languageName}
2. Be specific and practical
3. Reference known facts: "You mentioned that...", "Your goal #3...", "In the note [[X]]..."
4. Format: Telegram markdown (**bold**, \`code\`, lists)
${codeAgentSection}${twilioSection}${memoriesSection}${goalsSection}${vaultSection}${checkInSection}
## Conversation Context
${conversationContext}`;
}
