#!/usr/bin/env bash
# Parse claude stream-json output into readable terminal format
# Usage: claude -p --output-format stream-json "prompt" | ./scripts/parse-stream.sh

jq -r --unbuffered '
# Text content from assistant messages
if .type == "assistant" and .message.content then
    .message.content[] |
    if .type == "text" and .text then
        "\u001b[0;37m" + .text + "\u001b[0m"
    elif .type == "tool_use" then
        "\u001b[0;36m  \u2192 " + .name + ": " + (.input.description // .input.prompt // .input.command // .input.pattern // .input.file_path // "..." | tostring | .[0:100]) + "\u001b[0m"
    elif .type == "thinking" then
        "\u001b[0;33m  [thinking] " + (.thinking | .[0:120] | gsub("\n"; " ")) + "...\u001b[0m"
    else
        empty
    end

# Tool results (brief)
elif .type == "tool_result" then
    "\u001b[0;32m  \u2713 tool done\u001b[0m"

# Result/completion
elif .type == "result" then
    "\u001b[0;35m\u2501\u2501\u2501 agent finished \u2501\u2501\u2501\u001b[0m"

else
    empty
end
' 2>/dev/null
