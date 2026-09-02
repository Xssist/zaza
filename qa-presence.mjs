export default async function run(page) {
  const wsLog = [];
  page.on('websocket', ws => {
    wsLog.push('OPEN ' + ws.url());
    ws.on('framereceived', f => { const p = f.payload; wsLog.push('RECV ' + String(p).slice(0, 160)); });
    ws.on('framesent', f => wsLog.push('SENT ' + String(f.payload).slice(0, 80)));
    ws.on('close', () => wsLog.push('CLOSED'));
  });
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(8000);
  const state = await page.evaluate(() => ({
    dc: document.getElementById('presence-discord')?.className,
    dot: document.querySelector('.pc-status-dot')?.dataset?.status ?? null,
    name: document.querySelector('.pc-name')?.textContent ?? null,
    sp: document.getElementById('presence-spotify')?.className,
  }));
  return { wsLog: wsLog.slice(0, 20), state };
}
