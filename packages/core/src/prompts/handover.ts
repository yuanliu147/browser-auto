import type { Message } from "../loop/types.js";
import type { PathStep, MemorizedPath } from "../memory/types.js";
import { ACT_SYSTEM_PROMPT } from "./system.js";

function stepToDetailedDescription(step: PathStep): string {
  const selector =
    (step.args.ref as string | undefined) ??
    (step.args.selector as string | undefined);
  const target = selector ? `（选择器：${selector}）` : "";

  switch (step.tool) {
    case "navigate": {
      const url = step.args.url as string | undefined;
      return url ? `导航到 ${url}` : "导航到页面";
    }
    case "fill": {
      const value = step.args.value as string | undefined;
      return value ? `填入 "${value}"${target}` : `填写表单字段${target}`;
    }
    case "click": {
      return `点击元素${target}`;
    }
    case "press": {
      const key = step.args.key as string | undefined;
      return key ? `按下 ${key} 键` : "按键";
    }
    case "hover": {
      return `悬停元素${target}`;
    }
    case "select": {
      const value = step.args.value as string | undefined;
      return value ? `选择 "${value}"${target}` : `选择选项${target}`;
    }
    case "scroll": {
      const direction = step.args.direction as string | undefined;
      return direction
        ? `向${direction === "up" ? "上" : "下"}滚动`
        : "滚动页面";
    }
    case "waitFor": {
      const ms = step.args.ms as number | undefined;
      const sel = step.args.selector as string | undefined;
      if (ms !== undefined) return `等待 ${ms}ms`;
      if (sel) return `等待元素 ${sel}`;
      return "等待";
    }
    case "tabs": {
      const action = step.args.action as string | undefined;
      if (action === "new") return "打开新标签页";
      if (action === "switch") return "切换标签页";
      return "操作标签页";
    }
    default:
      return `执行 ${step.tool}`;
  }
}

export function buildHandoverMessages(
  instruction: string,
  memorizedPath: MemorizedPath,
  completedStepIndices: number[],
  failedStepIndex: number,
  failedError: string,
  currentSnapshot: string
): Message[] {
  const totalSteps = memorizedPath.steps.length;
  const failedStep = memorizedPath.steps[failedStepIndex];

  // Build expected path with status markers
  const pathLines: string[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const step = memorizedPath.steps[i];
    const desc = stepToDetailedDescription(step);
    const num = i + 1;
    if (i < failedStepIndex) {
      pathLines.push(`${num}. ✓ ${desc}`);
    } else if (i === failedStepIndex) {
      pathLines.push(`${num}. ✗ ${desc}`);
    } else {
      pathLines.push(`${num}. ○ ${desc}（待执行）`);
    }
  }

  const completedSteps = completedStepIndices.map(
    (i) => memorizedPath.steps[i]
  );
  const remainingSteps = memorizedPath.steps.slice(failedStepIndex + 1);

  const failedDesc = stepToDetailedDescription(failedStep);

  const content = `<task>
${instruction}
</task>

<expected_path>
${pathLines.join("\n")}
</expected_path>

<execution_status>
<completed>
${completedSteps.length > 0 ? completedSteps.map((s, i) => `- 步骤${completedStepIndices[i] + 1}：${stepToDetailedDescription(s)}`).join("\n") : "（无）"}
</completed>

<failed>
- 步骤${failedStepIndex + 1}：${failedDesc}
- 失败原因：${failedError}
</failed>

<remaining>
${remainingSteps.length > 0 ? remainingSteps.map((s, i) => `- 步骤${failedStepIndex + 1 + i + 1}：${stepToDetailedDescription(s)}`).join("\n") : "（无）"}
</remaining>
</execution_status>

<current_page>
${currentSnapshot}
</current_page>

<workflow>
请按以下流程处理：

1. 分析：调用 getSnapshot() 获取当前页面完整结构，判断当前页面是否支持继续完成剩余步骤。

2. 决策：选择以下两种策略之一：

   策略A - 继续执行（推荐，如果页面结构仍支持）：
   - 直接执行剩余步骤，不要重复已完成的工作
   - 不要重新导航页面
   - 不要重新填写已完成的字段
   - 重新定位失效的元素（参考之前的选择器，但可能需要用新的方式）

   策略B - 重新开始（仅在页面完全改变时使用）：
   - 从头执行整个任务

3. 执行：根据选择的策略调用工具。
</workflow>

<constraints>
- 不要重新导航页面，除非当前页面完全不对
- 不要重新填写已完成的字段
- 之前使用的选择器仅供参考，可能已失效，请基于当前页面重新定位
- 优先尝试完成剩余任务，而不是重置整个流程
</constraints>

<example>
假设当前页面仍是登录页，表单已填写，只是登录按钮的 id 从 #b 变成了 #login-btn：
- 正确做法：直接点击 #login-btn，然后继续后续步骤
- 错误做法：重新导航页面、重新填写表单
</example>`;

  return [
    { role: "system", content: ACT_SYSTEM_PROMPT },
    { role: "user", content: content },
  ];
}
