// Same-origin script keeps printing compatible with the existing strict CSP.
window.addEventListener('load', async () => {
  await document.fonts.ready;
  if ([...document.images].some(image => !image.complete || !image.naturalWidth)) {
    const error = document.createElement('p');
    error.textContent = 'A report image could not be loaded. Reload before printing.';
    error.setAttribute('role', 'alert');
    document.body.prepend(error);
    return;
  }
  window.print();
});
