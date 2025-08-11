const displayExpression = document.getElementById('display-expression');
const displayCurrent = document.getElementById('display-current');
const keypad = document.querySelector('.keypad');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history');
const themeToggle = document.getElementById('theme-toggle');

const HISTORY_KEY = 'calcHistory.v1';
const THEME_KEY = 'calcTheme.v1';

let tokens = [];           // tokens excluding currentInput
let currentInput = '';     // string being typed
let lastResult = null;     // numeric result of last evaluation

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
      themeToggle.checked = saved === 'dark';
      return;
    }
  } catch {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  themeToggle.checked = prefersDark;
}

function saveTheme() {
  const theme = themeToggle.checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

themeToggle.addEventListener('change', saveTheme);
loadTheme();

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20))); } catch {}
}

function formatNumberForDisplay(num) {
  if (!isFinite(num)) return 'Error';
  const abs = Math.abs(num);
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e12)) {
    return num.toExponential(8).replace(/\+?0*(?=\d)/, '');
  }
  // Limit total length
  const fixed = Number(num.toPrecision(12));
  return fixed.toString();
}

function updateDisplays() {
  const expr = [...tokens];
  if (currentInput !== '') expr.push(currentInput);
  displayExpression.textContent = expr.join(' ');
  displayCurrent.textContent = currentInput === '' ? (lastResult !== null ? formatNumberForDisplay(lastResult) : '0') : currentInput;
}

function isOperator(t) { return t === '+' || t === '-' || t === '*' || t === '/'; }
function isLeftParen(t) { return t === '('; }
function isRightParen(t) { return t === ')'; }

function inputDigit(d) {
  if (currentInput === '0') currentInput = '';
  if (currentInput.length >= 24) return; // guard
  currentInput += d;
  updateDisplays();
}

function inputDot() {
  if (currentInput === '') {
    currentInput = '0.';
  } else if (!currentInput.includes('.')) {
    currentInput += '.';
  }
  updateDisplays();
}

function toggleSign() {
  if (currentInput === '') {
    currentInput = '-';
  } else if (currentInput === '-') {
    currentInput = '';
  } else if (currentInput.startsWith('-')) {
    currentInput = currentInput.slice(1);
  } else {
    currentInput = '-' + currentInput;
  }
  updateDisplays();
}

function percent() {
  if (currentInput === '' || currentInput === '-') return;
  const val = Number(currentInput);
  if (!isFinite(val)) return;
  currentInput = String(val / 100);
  updateDisplays();
}

function canInsertImplicitMul() {
  if (currentInput !== '') return /\d|\)/.test(tokens[tokens.length - 1] || '') || /\d|\)/.test(currentInput);
  const last = tokens[tokens.length - 1];
  return last && (last === ')' || /\d$/.test(last));
}

function inputParen(paren) {
  if (paren === '(') {
    // Implicit multiplication: e.g., 2(3+4) or )(
    if (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      if ((currentInput !== '' && /\d$/.test(currentInput)) || last === ')' || /\d$/.test(last)) {
        commitCurrentInput();
        tokens.push('*');
      }
    }
    tokens.push('(');
    updateDisplays();
    return;
  }
  // ')'
  if (currentInput !== '' && currentInput !== '-') commitCurrentInput();
  // Only add if there's a matching '('
  const opens = tokens.filter(isLeftParen).length;
  const closes = tokens.filter(isRightParen).length;
  if (opens > closes && !isOperator(tokens[tokens.length - 1]) && tokens[tokens.length - 1] !== '(') {
    tokens.push(')');
  }
  updateDisplays();
}

function inputOperator(op) {
  // Support unary '-' when appropriate
  const lastToken = tokens[tokens.length - 1];
  const lastIsOpOrLeft = !tokens.length || isOperator(lastToken) || lastToken === '(';
  if (op === '-' && (currentInput === '' || currentInput === '0') && lastIsOpOrLeft) {
    toggleSign();
    return;
  }

  if (currentInput === '' || currentInput === '-') {
    // Replace operator if last is operator
    if (isOperator(lastToken)) {
      tokens[tokens.length - 1] = op;
    } else if (lastToken === undefined) {
      tokens.push('0', op);
    } else if (lastToken === '(') {
      tokens.push('0', op);
    } else if (lastToken === ')') {
      tokens.push(op);
    }
  } else {
    commitCurrentInput();
    tokens.push(op);
  }
  updateDisplays();
}

function commitCurrentInput() {
  if (currentInput === '' || currentInput === '-') return;
  // normalize number string
  if (currentInput.endsWith('.')) currentInput = currentInput.slice(0, -1);
  tokens.push(currentInput);
  currentInput = '';
}

function clearAll() {
  tokens = [];
  currentInput = '';
  lastResult = null;
  updateDisplays();
}

function backspace() {
  if (currentInput !== '') {
    currentInput = currentInput.slice(0, -1);
  } else if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (!isOperator(last) && last !== '(' && last !== ')') {
      // It's a number; move to currentInput to edit
      currentInput = String(last);
      tokens.pop();
      currentInput = currentInput.slice(0, -1);
    } else {
      tokens.pop();
    }
  }
  updateDisplays();
}

function buildFullTokens() {
  const arr = [...tokens];
  if (currentInput !== '' && currentInput !== '-') arr.push(currentInput);
  return arr;
}

function evaluate() {
  try {
    const inputTokens = buildFullTokens();
    if (inputTokens.length === 0) return;
    // Balance closing parens automatically if needed
    const opens = inputTokens.filter(isLeftParen).length;
    const closes = inputTokens.filter(isRightParen).length;
    for (let i = 0; i < opens - closes; i++) inputTokens.push(')');

    const rpn = toRPN(inputTokens);
    const result = evalRPN(rpn);
    if (!isFinite(result)) throw new Error('Not finite');

    const expressionStr = inputTokens.join(' ');
    addToHistory(expressionStr, result);

    tokens = [];
    currentInput = '';
    lastResult = result;
    updateDisplays();
  } catch (e) {
    displayCurrent.textContent = 'Error';
  }
}

function precedence(op) { return op === '+' || op === '-' ? 1 : op === '*' || op === '/' ? 2 : 0; }
function toRPN(inTokens) {
  const output = [];
  const stack = [];
  for (const t of inTokens) {
    if (isOperator(t)) {
      while (stack.length && isOperator(stack[stack.length - 1]) && precedence(stack[stack.length - 1]) >= precedence(t)) {
        output.push(stack.pop());
      }
      stack.push(t);
    } else if (t === '(') {
      stack.push(t);
    } else if (t === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') output.push(stack.pop());
      if (stack.length && stack[stack.length - 1] === '(') stack.pop();
    } else {
      // number token
      output.push(t);
    }
  }
  while (stack.length) output.push(stack.pop());
  return output;
}

function evalRPN(rpn) {
  const stack = [];
  for (const t of rpn) {
    if (isOperator(t)) {
      const b = Number(stack.pop());
      const a = Number(stack.pop());
      let v = 0;
      switch (t) {
        case '+': v = a + b; break;
        case '-': v = a - b; break;
        case '*': v = a * b; break;
        case '/': v = a / b; break;
      }
      stack.push(v);
    } else {
      const num = Number(t);
      if (!isFinite(num)) throw new Error('NaN');
      stack.push(num);
    }
  }
  if (stack.length !== 1) throw new Error('Bad expression');
  return stack[0];
}

function addToHistory(expression, result) {
  const list = loadHistory();
  list.unshift({ expression, result });
  saveHistory(list);
  renderHistory(list);
}

function renderHistory(list = loadHistory()) {
  historyList.innerHTML = '';
  list.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'history__item';

    const left = document.createElement('div');
    left.className = 'history__expr';
    left.textContent = item.expression;

    const right = document.createElement('div');
    right.className = 'history__res';
    right.textContent = formatNumberForDisplay(item.result);

    li.appendChild(left);
    li.appendChild(right);

    li.title = 'Click to reuse result';
    li.addEventListener('click', () => {
      tokens = [];
      currentInput = String(item.result);
      lastResult = item.result;
      updateDisplays();
    });

    historyList.appendChild(li);
  });
}

clearHistoryBtn.addEventListener('click', () => { saveHistory([]); renderHistory([]); });
renderHistory();

keypad.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.digit) return inputDigit(btn.dataset.digit);
  if (btn.dataset.dot) return inputDot();
  if (btn.dataset.op) return inputOperator(btn.dataset.op);
  if (btn.dataset.paren) return inputParen(btn.dataset.paren);

  const action = btn.dataset.action;
  switch (action) {
    case 'equals': return evaluate();
    case 'clear': return clearAll();
    case 'backspace': return backspace();
    case 'sign': return toggleSign();
    case 'percent': return percent();
  }
});

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (/^[0-9]$/.test(k)) { inputDigit(k); return; }
  if (k === '.') { inputDot(); return; }
  if (k === '+' || k === '-' || k === '*' || k === '/') { inputOperator(k); e.preventDefault(); return; }
  if (k === '(' || k === ')') { inputParen(k); e.preventDefault(); return; }
  if (k === 'Enter' || k === '=') { evaluate(); e.preventDefault(); return; }
  if (k === 'Backspace') { backspace(); e.preventDefault(); return; }
  if (k === 'Escape') { clearAll(); e.preventDefault(); return; }
});

updateDisplays();