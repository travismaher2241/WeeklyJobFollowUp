document.querySelectorAll('form[data-busy]').forEach(form=>form.addEventListener('submit',()=>{const b=form.querySelector('button');b.disabled=true;b.textContent=form.dataset.busy;}));
const search=document.getElementById('customerSearch');
search?.addEventListener('input',()=>{let visible=0;document.querySelectorAll('[data-customer]').forEach(row=>{row.hidden=!row.dataset.customer.includes(search.value.trim().toLowerCase());if(!row.hidden)visible++;});document.getElementById('noResults').hidden=visible>0;});
