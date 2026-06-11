function createAiRouter(options = {}) {
  const callWithRetry = options.callWithRetry;
  const callOnce = options.callOnce;
  const getMetrics = options.getMetrics || (() => ({}));
  const getConfig = options.getConfig || (() => ({}));
  const pushLog = options.pushLog || (() => {});

  async function run(task, payload = {}, runOptions = {}) {
    if (!task) throw new Error("AI task is required");
    const started = Date.now();
    try {
      const result = runOptions.once
        ? await callOnce(task, payload)
        : await callWithRetry(task, payload);
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
    runBatch,
    metrics: getMetrics,
    config: getConfig
  };
}

module.exports = { createAiRouter };
