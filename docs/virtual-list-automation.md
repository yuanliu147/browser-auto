# 虚拟列表/虚拟下拉自动化设计方案

## 核心难点

虚拟列表/虚拟下拉的**目标元素不在 DOM 中**，无法通过标准 `querySelector` 直接定位。

---

## 整体架构

```
┌─────────────────────────────────────────┐
│              用户 API 层                 │  click(selector), selectDropdown(...)
├─────────────────────────────────────────┤
│            元素定位引擎                  │  标准DOM查询 / 智能等待 / 虚拟滚动适配
├─────────────────────────────────────────┤
│         虚拟列表驱动层 (VirtualDriver)    │  键盘导航 / 滚动触发 / 框架识别
├─────────────────────────────────────────┤
│           底层执行层 (Playwright/Puppeteer)
└─────────────────────────────────────────┘
```

---

## 核心策略：键盘优先，滚动兜底

虚拟列表最常见的触发方式是**键盘导航（ArrowDown/ArrowUp）**，比鼠标滚动更可靠。

```typescript
async function selectVirtualOption(
  triggerSelector: string, // 下拉框触发按钮
  targetText: string, // 要选择的选项文本
  options: {
    itemSelector: string; // 选项的CSS选择器（出现后才可用）
    containerSelector?: string; // 滚动容器
  }
) {
  // 1. 打开下拉
  await page.click(triggerSelector);

  // 2. 键盘导航遍历（对虚拟列表最友好）
  let found = false;
  let attempts = 0;
  const maxAttempts = 200;

  while (!found && attempts < maxAttempts) {
    const items = await page.locator(options.itemSelector).all();
    for (const item of items) {
      const text = await item.textContent();
      if (text?.trim() === targetText) {
        await item.click();
        found = true;
        break;
      }
    }

    if (!found) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(50);
    }
    attempts++;
  }
}
```

### 三种 Fallback 策略

| 场景             | 策略                                                 | 适用组件                        |
| ---------------- | ---------------------------------------------------- | ------------------------------- |
| **标准虚拟列表** | `ArrowDown` 键盘导航                                 | Ant Design Select, Element Plus |
| **无限滚动列表** | 滚动到容器底部 + `MutationObserver` 等待新元素       | 表格、长列表                    |
| **已知索引**     | 直接计算滚动位置（`scrollTop = index * itemHeight`） | 固定高度虚拟列表                |

```typescript
async function scrollToReveal(
  containerSelector: string,
  targetSelector: string
) {
  const container = await page.locator(containerSelector);

  await container.evaluate(async (el, targetSel) => {
    return new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.querySelector(targetSel)) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(el, { childList: true, subtree: true });

      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });

      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000);
    });
  }, targetSelector);
}
```

### 框架感知优化

```typescript
const STRATEGIES = {
  "ant-select": {
    trigger: ".ant-select-selector",
    dropdown: ".ant-select-dropdown",
    option: ".ant-select-item-option",
    driver: "keyboard",
  },
  "el-select-v2": {
    trigger: ".el-select-v2__wrapper",
    option: ".el-select-dropdown__item",
    driver: "keyboard",
  },
  "el-table-v2": {
    container: ".el-table-v2__body",
    row: ".el-table-v2__row",
    driver: "scroll-position",
    rowHeight: 50,
  },
};
```

### 关键设计决策

| 决策                 | 选择                    | 原因                                    |
| -------------------- | ----------------------- | --------------------------------------- |
| **键盘 vs 鼠标滚动** | 优先键盘                | 虚拟列表对键盘事件的响应更稳定          |
| **固定行高假设**     | 不依赖                  | 中后台很多列表行高不固定                |
| **框架耦合**         | 轻度耦合                | 内置常见 UI 库策略，但提供通用 fallback |
| **等待机制**         | MutationObserver + 超时 | 比固定 sleep 更快更稳                   |

---

## 虚拟列表识别方案

识别采用**先静态推测，再动态验证**的两阶段策略。

### 第一层：DOM 静态特征

```typescript
function detectVirtualList(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const isScrollable = /(auto|scroll)/.test(style.overflowY);

  const actualChildren = el.querySelectorAll(":scope > *").length;
  const declaredSize = parseInt(el.getAttribute("aria-setsize") || "0", 10);

  const hasSpacer =
    el.querySelector('[style*="height"]:not([class])') !== null ||
    el.querySelector(':scope > div:first-child > div[style*="transform"]') !==
      null;

  const content = el.querySelector(":scope > div");
  const hasOffset =
    content &&
    /translateY|paddingTop/.test(content.getAttribute("style") || "");

  return (
    isScrollable &&
    (hasSpacer ||
      hasOffset ||
      (declaredSize > 0 && actualChildren < declaredSize))
  );
}
```

**常见库指纹：**

| 库                        | 特征                                            |
| ------------------------- | ----------------------------------------------- |
| `react-window`            | 内含 `div[style*="transform: translateY"]`      |
| `react-virtualized`       | 类名含 `ReactVirtualized__List`                 |
| `@tanstack/react-virtual` | 容器 `overflow: auto` + 子项绝对定位/translate  |
| Ant Design Select         | `.ant-select-dropdown` + `.rc-virtual-list`     |
| Element Plus `select-v2`  | `.el-select-dropdown__list` + `.el-vl__wrapper` |

### 第二层：动态探测（确认）

```typescript
async function confirmVirtual(page, selector: string): Promise<boolean> {
  return page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;

    const before = el.querySelectorAll("*").length;
    const beforeScroll = el.scrollTop;

    el.scrollBy({ top: 100, behavior: "instant" });

    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 50));

    const after = el.querySelectorAll("*").length;

    el.scrollTo({ top: beforeScroll, behavior: "instant" });

    const domChanged = after !== before;
    const scrollRatio = el.scrollHeight / el.clientHeight;
    const childCount = el.children.length;
    const looksVirtual = scrollRatio > 3 && childCount < scrollRatio * 2;

    return domChanged || looksVirtual;
  }, selector);
}
```

**探测原理：** 真实虚拟列表在滚动后一定会**增删 DOM 节点**或**替换已有节点的内容**。

### 第三层：语义推断

```typescript
async function select(page, label: string, value: string) {
  const trigger = await page.locator(`[placeholder="${label}"]`).first();
  await trigger.click();

  const dropdown = await page
    .locator('.ant-select-dropdown, .el-popper, [role="listbox"]')
    .first();

  const isVirtual = await dropdown.evaluate((el) => {
    const list = el.querySelector('[class*="virtual"], [class*="list"]') || el;
    return (
      list.scrollHeight > list.clientHeight * 2 && list.children.length < 20
    );
  });

  if (isVirtual) {
    await selectByKeyboard(page, dropdown, value);
  } else {
    await dropdown.locator(`text=${value}`).click();
  }
}
```

### 识别 -> 策略映射

```typescript
type VirtualStrategy =
  | { type: "none" }
  | { type: "keyboard" }
  | { type: "scroll-wait" }
  | { type: "position-calc" };

async function detectStrategy(
  page,
  selector: string
): Promise<VirtualStrategy> {
  const frameworkHint = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el?.closest(".rc-virtual-list")) return "keyboard";
    if (el?.closest(".el-vl__wrapper")) return "scroll-wait";
    return null;
  }, selector);

  if (frameworkHint) return { type: frameworkHint };

  const isVirtual = await confirmVirtual(page, selector);
  if (!isVirtual) return { type: "none" };

  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el?.querySelector('[role="option"]')) return { type: "keyboard" };
    if (el?.getAttribute("data-row-height")) return { type: "position-calc" };
    return { type: "scroll-wait" };
  }, selector);
}
```

---

## 关键原则

| 问题                       | 方案                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| **怎么知道是虚拟的？**     | DOM 特征（spacer/translate/节点少）+ 滚动探测（节点数变化）                         |
| **探测有副作用吗？**       | 滚动后**恢复原位**，用户无感知                                                      |
| **要不要每次操作都探测？** | 不需要。首次探测后**缓存结果**到元素引用上                                          |
| **类名变了怎么办？**       | 核心依赖**结构特征**（`scrollHeight >> clientHeight` + 子节点少），类名只是加速路径 |

> **最鲁棒的判断依据：** `scrollHeight` 很大但实际子节点很少 —— 这是所有虚拟列表的物理必然。
