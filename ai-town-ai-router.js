function createAiRouter(options = {}) {
  const callWithRetry = options.callWithRetry;
  const callOnce = options.callOnce;
  const getMetrics = options.getMetrics || (() => ({}));
  const getConfig = options.getConfig || (() => ({}));
  const pushLog = options.pushLog || (() => {});
  const runtime = options.runtime || null;

  async function runOnce(task, payload = {}, retryEpoch = runtime?.getRetryEpoch?.()) {
    if (callOnce) return callOnce(task, payload, retryEpoch);
    if (!runtime) throw new Error("AI router runtime is not configured");
    const selectedKey = runtime.nextApiKey();
    if (!selectedKey) throw runtime.makeNoKeyError();
    const started = Date.now();
    const metrics = runtime.metrics;
    const epoch = runtime.getMetricsEpoch();
    const selectedModel = runtime.modelForTask(task, payload);
    const trackedKey = selectedKey.index >= 0;
    const keyLabel = selectedKey.local ? "local" : `k${selectedKey.index + 1}`;
    metrics.total += 1;
    metrics.inFlight += 1;
    if (trackedKey) runtime.keyHealth[selectedKey.index].inFlight += 1;
    const callLog = runtime.pushCallLog({
      task,
      model: selectedModel,
      keyIndex: trackedKey ? selectedKey.index + 1 : 0,
      agentId: payload?.agent?.id || payload?.candidate?.agentId || "",
      agentName: payload?.agent?.name || "",
      status: "running",
      durationMs: 0,
      error: ""
    });
    metrics.lastTask = task;
    metrics.lastStatus = `running:${keyLabel}:${selectedModel}`;
    metrics.lastError = "";
    const controller = new AbortController();
    runtime.activeControllers.add(controller);
    let timeoutExpired = false;
    const timeout = setTimeout(() => {
      timeoutExpired = true;
      controller.abort();
    }, runtime.timeoutMs);
    try {
      const headers = { "content-type": "application/json" };
      if (selectedKey.key) headers.authorization = `Bearer ${selectedKey.key}`;
      const requestBody = {
        model: selectedModel,
        temperature: task === "scheduler" ? 0.25 : 0.55,
        messages: [
          { role: "system", content: runtime.systemPrompt(task) },
          { role: "user", content: runtime.userPrompt(task, payload) }
        ]
      };
      if (!selectedKey.local) requestBody.response_format = { type: "json_object" };
      const response = await fetch(`${runtime.aiConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw runtime.normalizeUpstreamError(text, response.status);
      const data = JSON.parse(text);
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI response has no message content");
      if (epoch === runtime.getMetricsEpoch()) {
        metrics.success += 1;
        metrics.lastStatus = `success:${keyLabel}`;
        if (trackedKey) runtime.markKeySuccess(selectedKey.index, Date.now() - started);
      }
      const parsed = runtime.strictJson(content, task);
      if (parsed?._fallback && epoch === runtime.getMetricsEpoch()) {
        metrics.jsonFallback += 1;
        metrics.lastError = parsed._fallback.reason.slice(0, 240);
        callLog.status = "json_fallback";
        callLog.error = parsed._fallback.reason.slice(0, 240);
        delete parsed._fallback;
      } else {
        callLog.status = "success";
      }
      callLog.durationMs = Date.now() - started;
      return parsed;
    } catch (error) {
      const handledError = !timeoutExpired && controller.signal.aborted && retryEpoch !== runtime.getRetryEpoch()
        ? runtime.makeCancelledError()
        : error;
      if (epoch === runtime.getMetricsEpoch()) {
        if (handledError.type === "ai_retry_cancelled") {
          metrics.lastStatus = `cancelled:${keyLabel}`;
          metrics.lastError = handledError.message.slice(0, 240);
        } else {
          metrics.failure += 1;
          metrics.lastStatus = `failed:${keyLabel}`;
          metrics.lastError = handledError.message.slice(0, 240);
          if (trackedKey) runtime.markKeyFailure(selectedKey.index, handledError, Date.now() - started);
        }
      }
      callLog.status = handledError.type === "ai_retry_cancelled" ? "cancelled" : "failed";
      callLog.durationMs = Date.now() - started;
      callLog.error = handledError.message.slice(0, 240);
      throw handledError;
    } finally {
      clearTimeout(timeout);
      runtime.activeControllers.delete(controller);
      if (epoch === runtime.getMetricsEpoch()) {
        metrics.inFlight = Math.max(0, metrics.inFlight - 1);
        if (trackedKey) runtime.keyHealth[selectedKey.index].inFlight = Math.max(0, runtime.keyHealth[selectedKey.index].inFlight - 1);
        metrics.lastDurationMs = Date.now() - started;
      }
    }
  }

  async function runWithRetry(task, payload = {}) {
    if (callWithRetry) return callWithRetry(task, payload);
    if (!runtime) throw new Error("AI router runtime is not configured");
    let attempt = 1;
    const retryEpoch = runtime.getRetryEpoch();
    while (true) {
      if (retryEpoch !== runtime.getRetryEpoch()) throw runtime.makeCancelledError();
      try {
        const result = await runOnce(task, payload, retryEpoch);
        runtime.setContinuousErrors(0);
        return result;
      } catch (error) {
        if (retryEpoch !== runtime.getRetryEpoch() || error?.type === "ai_retry_cancelled") throw runtime.makeCancelledError();
        const continuousErrors = runtime.addContinuousError();
        runtime.pushCallLog({
          task,
          model: runtime.modelForTask(task, payload),
          keyIndex: 0,
          agentId: payload?.agent?.id || payload?.candidate?.agentId || "",
          agentName: payload?.agent?.name || "",
          status: "retry_wait",
          durationMs: runtime.retryDelayMs,
          error: `全局连续错误 ${continuousErrors}；本请求第 ${attempt} 次失败：${String(error.message || error).slice(0, 180)}。将持续重试直到手动停止`
        });
        attempt += 1;
        await runtime.delayUnlessCancelled(runtime.retryDelayMs, retryEpoch);
      }
    }
  }

  async function run(task, payload = {}, runOptions = {}) {
    if (!task) throw new Error("AI task is required");
    const started = Date.now();
    try {
      const result = runOptions.once
        ? await runOnce(task, payload)
        : await runWithRetry(task, payload);
      pushLog({ task, status: "ok", durationMs: Date.now() - started });
      return result;
    } catch (error) {
      pushLog({ task, status: "error", durationMs: Date.now() - started, error: error.message });
      throw error;
    }
  }

  async function runBatch(items = [], concurrency = 1, worker = null) {
    const list = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Math.min(list.length || 1, Number(concurrency || 1)));
    const results = new Array(list.length);
    let cursor = 0;
    async function loop() {
      while (cursor < list.length) {
        const index = cursor;
        cursor += 1;
        const item = list[index];
        results[index] = worker ? await worker(item, index) : await run(item.task, item.payload || {}, item.options || {});
      }
    }
    await Promise.all(Array.from({ length: limit }, loop));
    return results;
  }

  return {
    run,
    runOnce,
    runWithRetry,
    runBatch,
    metrics: getMetrics,
    config: getConfig
  };
}

module.exports = { createAiRouter };
