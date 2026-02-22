/**
 * Multi-Agent Coding Team
 * Inspired by multimodal_coding_agent_team from awesome-llm-apps
 * 
 * Pipeline:
 *   1. PLANNER  — breaks down the task, identifies files to touch, makes a plan
 *   2. CODER    — implements the plan, writes actual code
 *   3. REVIEWER — critiques the code, suggests fixes, gives a quality score
 * 
 * Each agent streams its output in real-time back to the client.
 */

const AGENT_SYSTEM_PROMPTS = {
  planner: `You are the PLANNER agent in a multi-agent coding team. 
Your job is to analyze the user's request and produce a clear, structured implementation plan.

Output format:
## 🗺️ Plan
[2-3 sentence summary of what needs to be done]

## 📁 Files to touch
- List each file that needs to be created or modified
- One line per file, with a note on what changes

## 🔢 Steps
1. Step-by-step breakdown of the implementation
2. Keep it concrete and actionable
3. Note any dependencies or gotchas

## ⚠️ Things to watch out for
- Edge cases, potential bugs, or things the Coder should be careful about

Be concise. This is a plan, not code.`,

  coder: `You are the CODER agent in a multi-agent coding team.
You will receive a user request and a plan from the Planner. Your job is to implement it.

Rules:
- Write complete, working, production-quality code
- Always use proper markdown code fences with language tags
- If creating new files, start each with: FILE: path/to/file.ext
- If modifying existing files, clearly say which file and show the complete updated version
- Add helpful comments for non-obvious logic
- Follow the plan but use your judgment if you see a better approach
- Write idiomatic code for the language/framework being used`,

  reviewer: `You are the REVIEWER agent in a multi-agent coding team.
You will see the user's original request and the Coder's implementation. Your job is to review it critically.

Output format:
## 🔍 Code Review

### ✅ What's good
- List the strengths of the implementation

### 🐛 Issues found
- List any bugs, edge cases not handled, or errors (mark as 🔴 Critical, 🟡 Warning, 🔵 Suggestion)

### 💡 Improvements
- Concrete suggestions to make the code better

### 📊 Quality Score
Rate the code: X/10 — [one sentence reason]

### 🔧 Fixed version (if needed)
If there are critical issues, provide the corrected code. Skip this section if code is solid.

Be honest and specific. A score of 10/10 should be rare.`
};

async function runAgentStream(anthropicClient, openaiClient, model, systemPrompt, userMessage, onChunk) {
  if (model === 'claude') {
    const stream = anthropicClient.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        onChunk(chunk.delta.text);
      }
    }
    return fullText;
    
  } else {
    const stream = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    let fullText = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }
    return fullText;
  }
}

async function runTeam({ anthropicClient, openaiClient, model, userRequest, fileContext, ragContext, memoryContext, onEvent }) {
  const contextBlock = [
    memoryContext,
    fileContext ? `## Current file:\n\`\`\`\n${fileContext}\n\`\`\`` : '',
    ragContext || ''
  ].filter(Boolean).join('\n\n');

  const fullRequest = contextBlock 
    ? `${userRequest}\n\n---\n\n${contextBlock}`
    : userRequest;

  // ── PLANNER ──────────────────────────────────────────────────────────────────
  onEvent({ type: 'agent:start', agent: 'planner', label: '🗺️ Planner', message: 'Analyzing your request and creating a plan...' });

  let plannerOutput = '';
  await runAgentStream(
    anthropicClient, openaiClient, model,
    AGENT_SYSTEM_PROMPTS.planner,
    fullRequest,
    (chunk) => {
      plannerOutput += chunk;
      onEvent({ type: 'agent:chunk', agent: 'planner', text: chunk });
    }
  );

  onEvent({ type: 'agent:done', agent: 'planner' });

  // ── CODER ─────────────────────────────────────────────────────────────────────
  onEvent({ type: 'agent:start', agent: 'coder', label: '💻 Coder', message: 'Implementing the plan...' });

  const coderPrompt = `## User Request:\n${userRequest}\n\n## Plan from Planner:\n${plannerOutput}\n\n${contextBlock ? `## Context:\n${contextBlock}` : ''}\n\nNow implement this. Write the complete code.`;

  let coderOutput = '';
  await runAgentStream(
    anthropicClient, openaiClient, model,
    AGENT_SYSTEM_PROMPTS.coder,
    coderPrompt,
    (chunk) => {
      coderOutput += chunk;
      onEvent({ type: 'agent:chunk', agent: 'coder', text: chunk });
    }
  );

  onEvent({ type: 'agent:done', agent: 'coder' });

  // ── REVIEWER ─────────────────────────────────────────────────────────────────
  onEvent({ type: 'agent:start', agent: 'reviewer', label: '🔍 Reviewer', message: 'Reviewing the code for bugs and improvements...' });

  const reviewerPrompt = `## Original request:\n${userRequest}\n\n## Code written by Coder:\n${coderOutput}\n\nReview this code thoroughly.`;

  let reviewerOutput = '';
  await runAgentStream(
    anthropicClient, openaiClient, model,
    AGENT_SYSTEM_PROMPTS.reviewer,
    reviewerPrompt,
    (chunk) => {
      reviewerOutput += chunk;
      onEvent({ type: 'agent:chunk', agent: 'reviewer', text: chunk });
    }
  );

  onEvent({ type: 'agent:done', agent: 'reviewer' });
  onEvent({ type: 'team:done' });

  return { plan: plannerOutput, code: coderOutput, review: reviewerOutput };
}

module.exports = { runTeam };
