// keepalive-worker.js
// 【后台心跳线程】
// 此 Worker 的唯一职责：每15秒向主线程发送一次 PING，
// 让主线程有机会检查 AudioContext 状态并尝试恢复。
// 它不直接接触 AudioContext，因为 Worker 线程无法访问 Web Audio API。

let heartbeatInterval = null;

// 监听来自主线程的控制指令
self.addEventListener('message', (event) => {
    const { type } = event.data;

    if (type === 'START') {
        // 防止重复启动：如果已有定时器在运行，先清除它
        if (heartbeatInterval !== null) {
            clearInterval(heartbeatInterval);
        }
        // 启动心跳：每15000毫秒（15秒）向主线程发一次PING
        heartbeatInterval = setInterval(() => {
            self.postMessage({ type: 'PING' });
        }, 15000);

        // 立即发送第一次 PING，不用等15秒
        self.postMessage({ type: 'PING' });

    } else if (type === 'STOP') {
        // 收到停止指令：清除定时器，心跳停止
        if (heartbeatInterval !== null) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }
});
