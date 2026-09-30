// 100xpro 改版不变量验证：① 金额 ×100；② 小数位挂账结转
// 用法：node verify-100x.mjs
import { observeBalance } from './lib/accounting.mjs'
import {
  fractionFromSeed, fractionalState, fractionalBalance, fractionalUsage,
  reconcileSnapshot, accrueFractional, alignFractional,
} from './lib/index.js'

let pass = true
const check = (name, ok, extra = '') => {
  if (!ok) pass = false
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`)
}
const near = (a, b) => Math.abs(a - b) < 1e-6

// ============================================================================
// 第一部分：金额 ×100 基本盘
// ============================================================================
{
  const led = {}
  const feed = (real, iso) => observeBalance(led, { balance: real * 100, currency: 'CNY', scope: 'basictest', at: Date.parse(iso) })

  feed(10, '2026-09-29T09:00:00+08:00')
  let cur = led.accounting.books['basictest-CNY'].days['2026-09-29'].lastUnits / 1e8
  check('余额 10 → 1000', near(cur, 1000), `cur=${cur}`)

  feed(9.9, '2026-09-29T09:05:00+08:00')
  let row = led.accounting.books['basictest-CNY'].days['2026-09-29']
  cur = row.lastUnits / 1e8
  check('扣款 0.1 → 余额 990', near(cur, 990), `cur=${cur}`)
  check('扣款 0.1 → 今日已用 10', near(row.debitUnits / 1e8, 10))

  feed(9.7, '2026-09-29T09:10:00+08:00')
  row = led.accounting.books['basictest-CNY'].days['2026-09-29']
  cur = row.lastUnits / 1e8
  check('再扣 0.2 → 余额 970', near(cur, 970), `cur=${cur}`)
  check('累计扣款 0.3 → 今日已用 30', near(row.debitUnits / 1e8, 30))
}

// ============================================================================
// 第二部分：小数位挂账结转（模拟真实 余额快照 / 扣款 / 充值 序列）
// ============================================================================
const SCOPE = 'keyprint0123456789abcdefgh'
const CTX = SCOPE + '-CNY'
const DAY = '2026-09-30'
const led = {}

// 复刻 recordLedgerUsage 的快照+对账流程
function snapshot(real, iso) {
  const at = Date.parse(iso)
  const prevBook = led.accounting && led.accounting.books[CTX]
  const prevRow = prevBook && prevBook.days[DAY]
  const previousLastUnits = prevRow ? prevRow.lastUnits : null
  observeBalance(led, { balance: real * 100, currency: 'CNY', scope: SCOPE, at })
  const book = led.accounting.books[CTX]
  const frow = fractionalState(book, DAY, CTX)
  if (frow && previousLastUnits != null) reconcileSnapshot(frow, previousLastUnits)
  return frow
}

// 1) 当天首次快照：真实余额 295.67 → 播种确定性小数
let frow = snapshot(295.67, '2026-09-30T09:00:00+08:00')
const seed = fractionFromSeed(CTX + '|' + DAY)
check('种子是确定性 [0,1)', seed >= 0 && seed < 1, `seed=${seed.toFixed(6)}`)
check('期初余额 = 29567 + 种子', near(fractionalBalance(frow), 29567 + seed))

const openingDisplay = fractionalBalance(frow)

// 2) 挂一笔高精度扣款：真实 0.0139792 → 放大 1.39792
accrueFractional(frow, 1.39792)
let bal = fractionalBalance(frow)
let usage = fractionalUsage(frow)
check('扣款后余额 = 期初 − 1.39792', near(bal, openingDisplay - 1.39792), `bal=${bal.toFixed(4)}`)
check('扣款后今日已用 = 1.39792', near(usage, 1.39792))
check('恒等式：期初 − 余额 = 已用', near(openingDisplay - bal, usage))
check('余额两位小数不再是 .00', bal.toFixed(2).endsWith('.00') === false, `显示 ¥${bal.toFixed(2)}`)

// 3) API 整数快照对账：真实余额 295.66（API 确认了 1 个整分）
frow = snapshot(295.66, '2026-09-30T09:10:00+08:00')
bal = fractionalBalance(frow)
usage = fractionalUsage(frow)
check('对账后余额落在 [29566, 29567)', bal >= 29566 && bal < 29567, `bal=${bal.toFixed(4)}`)
check('对账后恒等式仍成立', near(openingDisplay - bal, usage), `usage=${usage.toFixed(4)}`)

// 4) 再来一轮：扣款真实 0.87341008 → 放大 87.341008，随后 API 快照 295.65
accrueFractional(frow, 87.341008)
frow = snapshot(295.65, '2026-09-30T09:20:00+08:00')
bal = fractionalBalance(frow)
usage = fractionalUsage(frow)
check('第二轮后余额落在 [29565, 29566)', bal >= 29565 && bal < 29566, `bal=${bal.toFixed(4)}`)
check('第二轮后恒等式仍成立', near(openingDisplay - bal, usage), `usage=${usage.toFixed(4)}`)

// 5) 充值场景：余额上升到 296.65，今日已用不得被冲减
const usageBeforeCredit = fractionalUsage(frow)
frow = snapshot(296.65, '2026-09-30T10:00:00+08:00')
bal = fractionalBalance(frow)
usage = fractionalUsage(frow)
check('充值后余额落在 [29665, 29666)', bal >= 29665 && bal < 29666, `bal=${bal.toFixed(4)}`)
check('充值不冲消费，已用不变', near(usage, usageBeforeCredit))

// 6) 手动校正对齐：指定目标已用 80.23、目标余额 29620.55
alignFractional(frow, 80.23, 29620.55)
check('校正后已用 = 80.23', near(fractionalUsage(frow), 80.23))
check('校正后余额 = 29620.55', near(fractionalBalance(frow), 29620.55))

// 7) 种子确定性：另起一本账、同样的首次快照 → 同样的种子
const led2 = {}
observeBalance(led2, { balance: 29567, currency: 'CNY', scope: SCOPE, at: Date.parse('2026-09-30T09:00:00+08:00') })
const f2 = fractionalState(led2.accounting.books[CTX], DAY, CTX)
check('同样输入 → 同样种子（重启不乱跳）', near(f2.xSeedUnits / 1e8, seed))

console.log(pass ? '\nALL_PASS ✅ ×100 与小数位挂账全部自洽' : '\nSOME_FAIL ❌')
process.exit(pass ? 0 : 1)
