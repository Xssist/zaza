export default async function run(page) {
  const wsLog = [];
  page.on('websocket', ws => {
    wsLog.push('OPEN');
    ws.on('framesent', f => wsLog.push('SENT ' + String(f.payload).slice(0,100)));
    ws.on('framereceived', f => wsLog.push('RECV ' + String(f.payload).slice(0,100)));
    ws.on('close', () => wsLog.push('CLOSED'));
  });
  await page.goto('http://localhost:8792', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(15000);
  const state = await page.evaluate(() => {
    const P = window.ZazaPresence;
    if (!P) return { noModule: true };
    const p = P.client.lastPresence;
    const out = { dcClass: document.getElementById('presence-discord')?.className, dcName: document.querySelector('.pc-name')?.textContent ?? null, spClass: document.getElementById('presence-spotify')?.className, degraded: P.degraded };
    if (p) {
      out.status = p.discord_status; out.user = p.discord_user?.username;
      try { P.discord.render(p, {}); out.renderOk = true; } catch (e) { out.renderErr = e.message + ' @ ' + (e.stack||'').split('\n')[1]; }
      out.dcAfterRender = { cls: document.getElementById('presence-discord')?.className, name: document.querySelector('.pc-name')?.textContent ?? null };
    }
    return out;
  });
  return { state, wsLog: wsLog.slice(0, 12) };
}
