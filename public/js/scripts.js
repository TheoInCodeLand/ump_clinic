// Client-side validation for appointment form
document.querySelectorAll('form[action="/student/appointments"]').forEach(form => {
  form.addEventListener('submit', (e) => {
    const date = form.querySelector('#date').value;
    const time = form.querySelector('#time').value;
    if (!date || !time) {
      e.preventDefault();
      alert('Please select both date and time.');
    }
  });
});