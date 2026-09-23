// Mobility workout: log sets and med ball weights (Sep 23 2026)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.wo-done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const ex = e.target.closest('.wo-ex');
      const key = ex.dataset.key;
      const weightInput = ex.querySelector('.wo-weight');
      const setsInput = ex.querySelector('.wo-sets');
      const weight = weightInput ? parseFloat(weightInput.value) || null : null;
      const sets = setsInput ? parseInt(setsInput.value) || 0 : 0;
      const status = ex.querySelector('.wo-ex-status');
      try {
        const res = await fetch('/api/program/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_key: key, kind: 'mobility', weight, sets_completed: sets }),
        });
        const data = await res.json();
        if (data.ok) {
          ex.classList.add('done');
          status.textContent = '✓ Logged';
          btn.disabled = true;
        } else {
          status.textContent = 'Failed to log';
        }
      } catch (err) {
        status.textContent = 'Error';
      }
    });
  });
});
