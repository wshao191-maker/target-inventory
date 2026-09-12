/* 供应链目标库存测算：计算内核 + 页面交互 */
(function () {
  "use strict";

  var STORAGE_KEY = "supplychain.targetInventory.params";
  var MODE_KEY = "supplychain.targetInventory.accuracyMode";
  var UNIT_KEY = "supplychain.targetInventory.displayUnit";

  /* ---------------- 计算内核 ---------------- */

  // Acklam 近似算法：标准正态分布反函数，用于把服务水平换算成 Z 值
  function inverseNormal(p) {
    if (!(p > 0 && p < 1)) {
      return NaN;
    }
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00];
    var pLow = 0.02425;
    var pHigh = 1 - pLow;
    var q;
    var r;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > pHigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /**
   * 计算目标库存。
   * v: { monthlyDemand, daysPerMonth, leadTime, leadTimeSd, accuracyMode, accuracyValue,
   *      serviceLevel, orderCycle, moq, frozenDays, onHand }
   * accuracyMode 取 "accuracy"（预测准确率%）或 "mape"（预测误差%）。
   */
  function compute(v) {
    var mape = v.accuracyMode === "mape" ? v.accuracyValue / 100 : 1 - v.accuracyValue / 100;
    var dailyDemand = v.monthlyDemand / v.daysPerMonth;
    var z = inverseNormal(v.serviceLevel / 100);

    var sigma = mape * dailyDemand;
    var sigmaRef = 1.25 * mape * dailyDemand;

    var leadDemand = dailyDemand * v.leadTime;
    var demandTerm = dailyDemand * dailyDemand * v.leadTimeSd * v.leadTimeSd;
    var safetyStock = z * Math.sqrt(v.leadTime * sigma * sigma + demandTerm);
    var safetyStockRef = z * Math.sqrt(v.leadTime * sigmaRef * sigmaRef + demandTerm);

    var cycleByDemand = dailyDemand * v.orderCycle;
    var cycleStock = 0.5 * Math.max(cycleByDemand, v.moq);
    var moqDrivesCycle = v.moq > cycleByDemand;

    var frozenStock = dailyDemand * v.frozenDays;

    var targetRaw = safetyStock + cycleStock + leadDemand + frozenStock;
    var target = Math.ceil(targetRaw);
    var targetRefRaw = safetyStockRef + cycleStock + leadDemand + frozenStock;
    var targetRef = Math.ceil(targetRefRaw);

    var targetDays = dailyDemand > 0 ? targetRaw / dailyDemand : null;
    var targetRefDays = dailyDemand > 0 ? targetRefRaw / dailyDemand : null;

    var needQty = target - v.onHand;
    var covered = needQty <= 0;
    var suggestedOrder = 0;
    var moqBound = false;
    if (!covered) {
      suggestedOrder = Math.max(v.moq, Math.ceil(needQty));
      moqBound = needQty < v.moq;
    }

    return {
      dailyDemand: dailyDemand,
      mape: mape,
      sigma: sigma,
      sigmaRef: sigmaRef,
      z: z,
      leadDemand: leadDemand,
      safetyStock: safetyStock,
      safetyStockRef: safetyStockRef,
      cycleStock: cycleStock,
      cycleByDemand: cycleByDemand,
      moqDrivesCycle: moqDrivesCycle,
      frozenStock: frozenStock,
      targetRaw: targetRaw,
      target: target,
      targetRefRaw: targetRefRaw,
      targetRef: targetRef,
      targetDays: targetDays,
      targetRefDays: targetRefDays,
      needQty: needQty,
      covered: covered,
      suggestedOrder: suggestedOrder,
      moqBound: moqBound
    };
  }

  if (typeof window !== "undefined") {
    window.TargetInventoryCore = { inverseNormal: inverseNormal, compute: compute };
  }

  if (typeof document === "undefined") {
    return; // Node 环境只导出计算内核，便于自检
  }

  /* ---------------- 展示工具 ---------------- */

  var $ = function (id) { return document.getElementById(id); };

  var fmtInt = function (n) {
    return Math.round(n).toLocaleString("zh-CN");
  };

  var fmtNum = function (n, digits) {
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: digits === undefined ? 2 : digits,
      maximumFractionDigits: digits === undefined ? 2 : digits
    });
  };

  var fmtPct = function (ratio, digits) {
    return fmtNum(ratio * 100, digits === undefined ? 2 : digits) + "%";
  };

  var toDays = function (qty, dailyDemand) {
    return dailyDemand > 0 ? qty / dailyDemand : null;
  };

  var fmtDays = function (days) {
    return days === null ? "—" : fmtNum(days, 1) + " 天";
  };

  var els = {
    form: $("calc-form"),
    errorSummary: $("error-summary"),
    sku: $("sku"),
    monthlyDemand: $("monthlyDemand"),
    daysPerMonth: $("daysPerMonth"),
    leadTime: $("leadTime"),
    leadTimeSd: $("leadTimeSd"),
    accuracyValue: $("accuracyValue"),
    accuracyLabel: $("accuracy-label"),
    accuracyHint: $("accuracy-hint"),
    serviceLevel: $("serviceLevel"),
    orderCycle: $("orderCycle"),
    moq: $("moq"),
    frozenDays: $("frozenDays"),
    onHand: $("onHand"),
    segButtons: Array.prototype.slice.call(document.querySelectorAll(".seg-btn[data-acc-mode]")),
    unitButtons: Array.prototype.slice.call(document.querySelectorAll(".seg-btn[data-unit]")),
    hintToggles: Array.prototype.slice.call(document.querySelectorAll(".hint-toggle")),
    resultEmpty: $("result-empty"),
    resultBody: $("result-body"),
    rLabel: $("r-label"),
    rTarget: $("r-target"),
    rUnit: $("r-unit"),
    rRaw: $("r-raw"),
    rStack: $("r-stack"),
    rBreakdown: $("r-breakdown"),
    rMetrics: $("r-metrics"),
    rSteps: $("r-steps"),
    rReference: $("r-reference"),
    rAdvice: $("r-advice"),
    copyBtn: $("copy-btn"),
    copyHint: $("copy-hint")
  };

  var NUM_FIELDS = [
    { id: "monthlyDemand", el: els.monthlyDemand, label: "月需求", required: true, min: 0 },
    { id: "daysPerMonth", el: els.daysPerMonth, label: "月计天数", required: true, exclusiveMin: 0 },
    { id: "leadTime", el: els.leadTime, label: "采购提前期", required: true, min: 0 },
    { id: "leadTimeSd", el: els.leadTimeSd, label: "提前期波动", required: false, min: 0 },
    { id: "serviceLevel", el: els.serviceLevel, label: "服务水平", required: true, min: 50, max: 99.99 },
    { id: "orderCycle", el: els.orderCycle, label: "下单周期", required: true, min: 0 },
    { id: "moq", el: els.moq, label: "MOQ", required: true, min: 0 },
    { id: "frozenDays", el: els.frozenDays, label: "冻结天数", required: false, min: 0 },
    { id: "onHand", el: els.onHand, label: "现有库存", required: false, min: 0 }
  ];

  var accuracyMode = "accuracy";
  var unitMode = "pieces";
  var lastValues = null;
  var lastResult = null;
  var lastCopyText = "";

  function readNumber(input) {
    var raw = input.value.trim();
    if (raw === "") {
      return null;
    }
    var value = Number(raw);
    return isFinite(value) ? value : NaN;
  }

  function setFieldError(id, message) {
    var input = $(id);
    var errorEl = $("err-" + id);
    var fieldEl = input.closest(".field");
    if (message) {
      fieldEl.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      fieldEl.classList.remove("invalid");
      input.removeAttribute("aria-invalid");
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }

  function clearErrors() {
    NUM_FIELDS.forEach(function (f) { setFieldError(f.id, ""); });
    setFieldError("accuracyValue", "");
    els.errorSummary.hidden = true;
    els.errorSummary.textContent = "";
  }

  function accuracyLabelText() {
    return accuracyMode === "mape" ? "预测误差 MAPE" : "预测准确率";
  }

  function updateAccuracyUi() {
    els.accuracyLabel.childNodes[0].nodeValue = accuracyLabelText() + " ";
    els.segButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.accMode === accuracyMode);
    });
    var value = readNumber(els.accuracyValue);
    if (accuracyMode === "accuracy") {
      if (value === null || isNaN(value)) {
        els.accuracyHint.textContent = "填预测准确率，如 85 表示 85%。";
      } else if (value > 0 && value <= 100) {
        els.accuracyHint.textContent = "相当于 MAPE " + fmtNum(100 - value) + "%。";
      } else {
        els.accuracyHint.textContent = "预测准确率需大于 0% 且不超过 100%。";
      }
    } else {
      if (value === null || isNaN(value)) {
        els.accuracyHint.textContent = "填预测误差，如 15 表示 15%。";
      } else if (value >= 0 && value < 100) {
        els.accuracyHint.textContent = "相当于预测准确率 " + fmtNum(100 - value) + "%。";
      } else {
        els.accuracyHint.textContent = "MAPE 不能为负数且需小于 100%。";
      }
    }
  }

  function updateUnitUi() {
    els.unitButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.unit === unitMode);
    });
  }

  function collect(validate) {
    var problems = [];
    var values = {};
    var fields = NUM_FIELDS.concat([
      { id: "accuracyValue", el: els.accuracyValue, label: accuracyLabelText(), required: true }
    ]);

    fields.forEach(function (f) {
      var value = readNumber(f.el);

      if (value === null) {
        if (f.required) {
          problems.push({ id: f.id, message: "请填写" + f.label });
          value = NaN;
        } else {
          value = 0;
        }
      } else if (isNaN(value)) {
        problems.push({ id: f.id, message: "请输入数字" });
      } else if (f.exclusiveMin !== undefined && value <= f.exclusiveMin) {
        problems.push({ id: f.id, message: f.label + "必须大于 " + f.exclusiveMin });
      } else if (f.min !== undefined && value < f.min) {
        problems.push({
          id: f.id,
          message: f.min === 0 ? "不能为负数" : f.label + "不能低于 " + f.min + (f.id === "serviceLevel" ? "%" : "")
        });
      } else if (f.max !== undefined && value > f.max) {
        problems.push({
          id: f.id,
          message: f.label + "不能高于 " + f.max + (f.id === "serviceLevel" ? "%" : "")
        });
      }

      values[f.id] = value;
    });

    var accuracyHasProblem = problems.some(function (p) { return p.id === "accuracyValue"; });
    if (!accuracyHasProblem) {
      if (accuracyMode === "accuracy" && (values.accuracyValue <= 0 || values.accuracyValue > 100)) {
        problems.push({ id: "accuracyValue", message: "预测准确率需大于 0% 且不超过 100%" });
      }
      if (accuracyMode === "mape" && (values.accuracyValue < 0 || values.accuracyValue >= 100)) {
        problems.push({ id: "accuracyValue", message: "MAPE 不能为负数且需小于 100%" });
      }
    }

    if (validate) {
      clearErrors();
      problems.forEach(function (p) { setFieldError(p.id, p.message); });
      if (problems.length) {
        els.errorSummary.textContent = "有 " + problems.length + " 项需要修正，请检查标红的字段。";
        els.errorSummary.hidden = false;
      }
    }

    return {
      problems: problems,
      values: {
        sku: els.sku.value.trim(),
        monthlyDemand: values.monthlyDemand,
        daysPerMonth: values.daysPerMonth,
        leadTime: values.leadTime,
        leadTimeSd: values.leadTimeSd,
        accuracyMode: accuracyMode,
        accuracyValue: values.accuracyValue,
        serviceLevel: values.serviceLevel,
        orderCycle: values.orderCycle,
        moq: values.moq,
        frozenDays: values.frozenDays,
        onHand: values.onHand
      }
    };
  }

  function addMetric(container, label, value) {
    var rowEl = document.createElement("div");
    rowEl.className = "metric";
    var labelEl = document.createElement("div");
    labelEl.className = "metric-label";
    labelEl.textContent = label;
    var valueEl = document.createElement("div");
    valueEl.className = "metric-value";
    valueEl.textContent = value;
    rowEl.appendChild(labelEl);
    rowEl.appendChild(valueEl);
    container.appendChild(rowEl);
  }

  function addBreakdownRow(container, name, value, total, colorClass, dailyDemand) {
    var share = total > 0 ? value / total : 0;
    var dayValue = toDays(value, dailyDemand);
    var rowEl = document.createElement("div");
    rowEl.className = "bd-row";

    var dot = document.createElement("span");
    dot.className = "bd-dot s" + colorClass;

    var nameEl = document.createElement("span");
    nameEl.className = "bd-name";
    nameEl.textContent = name;

    var valueEl = document.createElement("span");
    valueEl.className = "bd-value";
    valueEl.textContent = unitMode === "days" ? fmtDays(dayValue) : fmtNum(value) + " 件";
    var small = document.createElement("small");
    small.textContent = fmtPct(share, 1) + (dayValue === null
      ? ""
      : " · " + (unitMode === "days" ? fmtNum(value) + " 件" : fmtDays(dayValue)));
    valueEl.appendChild(small);

    rowEl.appendChild(dot);
    rowEl.appendChild(nameEl);
    rowEl.appendChild(valueEl);
    container.appendChild(rowEl);
  }

  // 100% 堆叠构成条：只渲染数值大于 0 的段，避免出现空缝
  function renderStack(container, segments, total, animate) {
    container.innerHTML = "";
    segments.forEach(function (s) {
      if (!(s.value > 0)) {
        return;
      }
      var seg = document.createElement("span");
      seg.className = "stack-seg s" + s.index;
      seg.style.flexGrow = String(s.value);
      seg.title = s.name + " " + fmtPct(total > 0 ? s.value / total : 0, 1);
      container.appendChild(seg);
    });

    container.classList.remove("is-in", "no-anim");
    if (animate) {
      void container.offsetWidth; // 触发重排，让从 0 展开的过渡生效
      container.classList.add("is-in");
    } else {
      container.classList.add("no-anim", "is-in");
    }
  }

  function addStep(container, text) {
    var li = document.createElement("li");
    li.textContent = text;
    container.appendChild(li);
  }

  function render(values, r, animate) {
    els.resultEmpty.hidden = true;
    els.resultBody.hidden = false;
    updateUnitUi();

    els.resultBody.classList.remove("is-fresh");
    if (animate) {
      void els.resultBody.offsetWidth; // 切换呈现口径时不重播入场动画
      els.resultBody.classList.add("is-fresh");
    }

    if (unitMode === "days") {
      els.rLabel.textContent = "目标库存可支撑天数";
      els.rTarget.textContent = r.targetDays === null ? "—" : fmtNum(r.targetDays, 1);
      els.rUnit.textContent = r.targetDays === null ? "" : "天";
      els.rRaw.textContent = r.targetDays === null
        ? "月需求为 0，无法折算库存天数。"
        : "按日均需求 " + fmtNum(r.dailyDemand) + " 件/天折算；对应目标库存 " + fmtInt(r.target) +
          " 件（原始值 " + fmtNum(r.targetRaw) + " 件）。";
    } else {
      els.rLabel.textContent = "目标库存水平";
      els.rTarget.textContent = fmtInt(r.target);
      els.rUnit.textContent = "件";
      els.rRaw.textContent = "原始值 " + fmtNum(r.targetRaw) + " 件，已向上取整为整数件" +
        (r.targetDays === null ? "。" : "；相当于 " + fmtNum(r.targetDays, 1) + " 天用量。");
    }

    els.rBreakdown.innerHTML = "";
    addBreakdownRow(els.rBreakdown, "安全库存", r.safetyStock, r.targetRaw, 1, r.dailyDemand);
    addBreakdownRow(els.rBreakdown, "周转库存", r.cycleStock, r.targetRaw, 2, r.dailyDemand);
    addBreakdownRow(els.rBreakdown, "提前期需求", r.leadDemand, r.targetRaw, 3, r.dailyDemand);
    addBreakdownRow(els.rBreakdown, "冻结库存", r.frozenStock, r.targetRaw, 4, r.dailyDemand);

    renderStack(els.rStack, [
      { index: 1, name: "安全库存", value: r.safetyStock },
      { index: 2, name: "周转库存", value: r.cycleStock },
      { index: 3, name: "提前期需求", value: r.leadDemand },
      { index: 4, name: "冻结库存", value: r.frozenStock }
    ], r.targetRaw, animate);

    els.rMetrics.innerHTML = "";
    addMetric(els.rMetrics, "日均需求", fmtNum(r.dailyDemand) + " 件/天");
    addMetric(els.rMetrics, "MAPE", fmtPct(r.mape));
    addMetric(els.rMetrics, "σ需求（主口径）", fmtNum(r.sigma) + " 件");
    addMetric(els.rMetrics, "Z 值", fmtNum(r.z, 3));

    els.rSteps.innerHTML = "";
    addStep(els.rSteps, "日均需求 = 月需求 ÷ 月计天数 = " + fmtNum(values.monthlyDemand) + " ÷ " +
      fmtNum(values.daysPerMonth) + " = " + fmtNum(r.dailyDemand) + " 件/天");
    addStep(els.rSteps, values.accuracyMode === "mape"
      ? "MAPE = " + fmtPct(r.mape) + "（直接录入）"
      : "MAPE = 1 − 预测准确率 = 1 − " + fmtPct(values.accuracyValue / 100) + " = " + fmtPct(r.mape));
    addStep(els.rSteps, "σ需求 = MAPE × 日均需求 = " + fmtPct(r.mape) + " × " + fmtNum(r.dailyDemand) +
      " = " + fmtNum(r.sigma) + " 件");
    addStep(els.rSteps, "Z 值 = 服务水平 " + fmtPct(values.serviceLevel / 100) + " 对应的标准正态分位数 = " +
      fmtNum(r.z, 3));
    addStep(els.rSteps, "提前期需求 = 日均需求 × 采购提前期 = " + fmtNum(r.dailyDemand) + " × " +
      fmtNum(values.leadTime) + " = " + fmtNum(r.leadDemand) + " 件");
    addStep(els.rSteps, "安全库存 = Z × √(提前期 × σ需求² + 日均需求² × 提前期波动²) = " + fmtNum(r.z, 3) +
      " × √(" + fmtNum(values.leadTime) + " × " + fmtNum(r.sigma) + "² + " + fmtNum(r.dailyDemand) +
      "² × " + fmtNum(values.leadTimeSd) + "²) = " + fmtNum(r.safetyStock) + " 件");
    addStep(els.rSteps, "周转库存 = 0.5 × max(日均需求 × 下单周期, MOQ) = 0.5 × max(" + fmtNum(r.dailyDemand) +
      " × " + fmtNum(values.orderCycle) + ", " + fmtNum(values.moq) + ") = " + fmtNum(r.cycleStock) + " 件" +
      (r.moqDrivesCycle ? "（MOQ 更大，由 MOQ 决定）" : ""));
    addStep(els.rSteps, "冻结库存 = 日均需求 × 冻结天数 = " + fmtNum(r.dailyDemand) + " × " +
      fmtNum(values.frozenDays) + " = " + fmtNum(r.frozenStock) + " 件");
    addStep(els.rSteps, "目标库存 = " + fmtNum(r.safetyStock) + " + " + fmtNum(r.cycleStock) + " + " +
      fmtNum(r.leadDemand) + " + " + fmtNum(r.frozenStock) + " = " + fmtNum(r.targetRaw) + " → 向上取整 " +
      fmtInt(r.target) + " 件");

    if (r.targetDays !== null) {
      addStep(els.rSteps, "库存天数 = 目标库存 ÷ 日均需求 = " + fmtNum(r.targetRaw) + " ÷ " +
        fmtNum(r.dailyDemand) + " = " + fmtNum(r.targetDays, 1) + " 天");
    }

    els.rReference.textContent = "参考口径：若把 σ需求 换成 1.25 × MAPE × 日均需求（即 " + fmtNum(r.sigmaRef) +
      " 件），安全库存为 " + fmtNum(r.safetyStockRef) + " 件，目标库存为 " + fmtInt(r.targetRef) +
      " 件（原始值 " + fmtNum(r.targetRefRaw) + "）" +
      (r.targetRefDays === null ? "。" : "，约 " + fmtNum(r.targetRefDays, 1) + " 天。");

    els.rAdvice.classList.remove("is-warn", "is-neutral");
    var orderDays = toDays(r.suggestedOrder, r.dailyDemand);
    if (r.covered) {
      els.rAdvice.textContent = "建议下单量：0 件。现有库存 " + fmtNum(values.onHand) + " 件已覆盖目标库存 " +
        fmtInt(r.target) + " 件，本周期无需下单。";
    } else {
      var text = "建议下单量：" + fmtInt(r.suggestedOrder) + " 件（目标库存 " + fmtInt(r.target) +
        " 件 − 现有库存 " + fmtNum(values.onHand) + " 件 = " + fmtNum(r.needQty) + " 件）";
      if (orderDays !== null) {
        text += "，约 " + fmtNum(orderDays, 1) + " 天用量";
      }
      if (r.moqBound) {
        els.rAdvice.classList.add("is-warn");
        text += "；缺口不足一个 MOQ，受 MOQ 下限约束，建议按 MOQ " + fmtNum(values.moq) + " 件下单。";
      } else if (values.moq > 0) {
        text += "；缺口已达到 MOQ，按实际缺口下单即可。";
      } else {
        text += "。";
      }
      els.rAdvice.textContent = text;
    }

    lastValues = values;
    lastResult = r;
    lastCopyText = buildCopyText(values, r);
  }

  function buildCopyText(values, r) {
    var shareOf = function (part) {
      return fmtPct(r.targetRaw > 0 ? part / r.targetRaw : 0, 1);
    };
    var both = function (qty) {
      var dayValue = toDays(qty, r.dailyDemand);
      if (dayValue === null) {
        return fmtNum(qty) + " 件";
      }
      return unitMode === "days"
        ? fmtNum(dayValue, 1) + " 天（" + fmtNum(qty) + " 件）"
        : fmtNum(qty) + " 件（" + fmtNum(dayValue, 1) + " 天）";
    };
    var lines = [];
    lines.push("【供应链目标库存测算】");
    if (values.sku) {
      lines.push("产品：" + values.sku);
    }
    lines.push("呈现口径：" + (unitMode === "days" ? "按天数" : "按件数"));
    lines.push("---------- 输入参数 ----------");
    lines.push("月需求：" + fmtNum(values.monthlyDemand) + " 件/月（月计 " + fmtNum(values.daysPerMonth) + " 天）");
    lines.push("采购提前期：" + fmtNum(values.leadTime) + " 天（波动 σ " + fmtNum(values.leadTimeSd) + " 天）");
    lines.push((values.accuracyMode === "mape" ? "MAPE：" : "预测准确率：") + fmtPct(values.accuracyValue / 100) +
      "（对应 MAPE " + fmtPct(r.mape) + "）");
    lines.push("服务水平：" + fmtPct(values.serviceLevel / 100) + "（Z = " + fmtNum(r.z, 3) + "）");
    lines.push("下单周期：" + fmtNum(values.orderCycle) + " 天，MOQ：" + fmtNum(values.moq) + " 件");
    lines.push("冻结天数：" + fmtNum(values.frozenDays) + " 天，现有库存：" + fmtNum(values.onHand) + " 件");
    lines.push("---------- 计算结果 ----------");
    lines.push("日均需求：" + fmtNum(r.dailyDemand) + " 件/天");
    lines.push("目标库存：" + both(r.target) + "（原始值 " + fmtNum(r.targetRaw) + " 件）");
    lines.push("  安全库存 " + both(r.safetyStock) + "（" + shareOf(r.safetyStock) + "）");
    lines.push("  周转库存 " + both(r.cycleStock) + "（" + shareOf(r.cycleStock) + "）");
    lines.push("  提前期需求 " + both(r.leadDemand) + "（" + shareOf(r.leadDemand) + "）");
    lines.push("  冻结库存 " + both(r.frozenStock) + "（" + shareOf(r.frozenStock) + "）");
    lines.push("建议下单量：" + fmtInt(r.suggestedOrder) + " 件" +
      (r.moqBound ? "（受 MOQ 下限约束）" : (r.covered ? "（现有库存已覆盖）" : "")));
    lines.push("参考（1.25 × MAPE 口径）目标库存：" + fmtInt(r.targetRef) + " 件" +
      (r.targetRefDays === null ? "" : "（约 " + fmtNum(r.targetRefDays, 1) + " 天）"));
    return lines.join("\n");
  }

  /* ---------------- 本地留存 ---------------- */

  function saveParams() {
    try {
      var data = { sku: els.sku.value, accuracyValue: els.accuracyValue.value };
      NUM_FIELDS.forEach(function (f) { data[f.id] = f.el.value; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(MODE_KEY, accuracyMode);
      localStorage.setItem(UNIT_KEY, unitMode);
    } catch (err) {
      /* 隐私模式下 localStorage 不可用时静默跳过 */
    }
  }

  function loadParams() {
    try {
      var savedMode = localStorage.getItem(MODE_KEY);
      if (savedMode === "accuracy" || savedMode === "mape") {
        accuracyMode = savedMode;
      }
      var savedUnit = localStorage.getItem(UNIT_KEY);
      if (savedUnit === "pieces" || savedUnit === "days") {
        unitMode = savedUnit;
      }
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      var data = JSON.parse(raw);
      if (typeof data !== "object" || data === null) {
        return;
      }
      if (typeof data.sku === "string") {
        els.sku.value = data.sku;
      }
      if (typeof data.accuracyValue === "string") {
        els.accuracyValue.value = data.accuracyValue;
      }
      NUM_FIELDS.forEach(function (f) {
        if (typeof data[f.id] === "string") {
          f.el.value = data[f.id];
        }
      });
    } catch (err) {
      /* 数据损坏时退回默认值 */
    }
  }

  function copyResult() {
    if (!lastCopyText) {
      return;
    }
    var done = function () {
      els.copyHint.textContent = "已复制到剪贴板";
      els.copyHint.hidden = false;
      window.setTimeout(function () { els.copyHint.hidden = true; }, 2000);
    };
    var fallbackCopy = function () {
      var area = document.createElement("textarea");
      area.value = lastCopyText;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        done();
      } catch (err) {
        els.copyHint.textContent = "复制失败，请手动选中结果文字";
        els.copyHint.hidden = false;
      }
      document.body.removeChild(area);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastCopyText).then(done, fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  els.segButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      accuracyMode = btn.dataset.accMode === "mape" ? "mape" : "accuracy";
      updateAccuracyUi();
      saveParams();
    });
  });

  els.unitButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      unitMode = btn.dataset.unit === "days" ? "days" : "pieces";
      updateUnitUi();
      saveParams();
      if (lastValues && lastResult) {
        render(lastValues, lastResult, false);
      }
    });
  });

  /* ---------------- 字段说明气泡 ---------------- */

  var hintPairs = els.hintToggles.map(function (btn) {
    return { button: btn, anchor: btn.closest(".hint-anchor") };
  }).filter(function (pair) {
    return pair.anchor;
  });

  function closeHints(except) {
    hintPairs.forEach(function (pair) {
      if (pair.anchor === except) {
        return;
      }
      pair.anchor.classList.remove("is-open");
      pair.button.setAttribute("aria-expanded", "false");
    });
  }

  hintPairs.forEach(function (pair) {
    pair.button.addEventListener("click", function (event) {
      event.preventDefault();
      var willOpen = !pair.anchor.classList.contains("is-open");
      closeHints(pair.anchor);
      pair.anchor.classList.toggle("is-open", willOpen);
      pair.button.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (!willOpen) {
        pair.button.blur();
      }
    });
  });

  document.addEventListener("click", function (event) {
    var target = event.target;
    var insideHint = target && typeof target.closest === "function" && target.closest(".hint-anchor");
    if (!insideHint) {
      closeHints();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
      return;
    }
    closeHints();
    var active = document.activeElement;
    if (active && typeof active.blur === "function" &&
        active.classList && active.classList.contains("hint-toggle")) {
      active.blur();
    }
  });

  var boundInputs = [els.sku, els.accuracyValue].concat(NUM_FIELDS.map(function (f) { return f.el; }));
  boundInputs.forEach(function (input) {
    input.addEventListener("input", function () {
      if (input === els.accuracyValue) {
        updateAccuracyUi();
      }
      saveParams();
    });
  });

  els.form.addEventListener("submit", function (event) {
    event.preventDefault();
    var collected = collect(true);
    if (collected.problems.length) {
      return;
    }
    render(collected.values, compute(collected.values), true);
  });

  els.copyBtn.addEventListener("click", copyResult);

  loadParams();
  updateAccuracyUi();
  updateUnitUi();
  saveParams();
})();
