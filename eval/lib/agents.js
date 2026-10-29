// The prompt is passed in EVAL_PROMPT. Override a command with EVAL_AGENT_CMD to use another client or flags.
export const defaults = {
  claude: 'claude -p "$EVAL_PROMPT" --dangerously-skip-permissions',
  codex: 'codex exec --dangerously-bypass-approvals-and-sandbox "$EVAL_PROMPT"',
  copilot: 'copilot -p "$EVAL_PROMPT" --allow-all-tools',
};
