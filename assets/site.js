(function(){
  function ordinal(n){
    const s=["th","st","nd","rd"], v=n%100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }

  function formatDate(iso, includeYear=true){
    if(!iso) return "";
    // Force local interpretation at midnight to avoid TZ drift
    const d = new Date(iso + "T00:00:00");
    const month = d.toLocaleString(undefined, { month: "long" });
    const day = ordinal(d.getDate());
    const year = d.getFullYear();
    return includeYear ? `${month} ${day} ${year}` : `${month} ${day}`;
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>\"']/g, m => ({'&':'&','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] || m));
  }

  async function copyOut(textareaId){
    const el = document.getElementById(textareaId);
    if(!el || !el.value) return;
    try{
      await navigator.clipboard.writeText(el.value);
      flash("Copied!");
    }catch(e){
      el.focus();
      el.select();
      flash("Press ⌘/Ctrl+C to copy");
    }
  }

  function flash(msg){
    const b = document.createElement("div");
    b.textContent = msg;
    Object.assign(b.style, {
      position:"fixed", bottom:"16px", right:"16px", padding:"8px 12px",
      background:"#0b1220", border:"1px solid #1f2e43", borderRadius:"10px",
      zIndex:"9999", boxShadow:"0 10px 30px rgba(0,0,0,.25)"
    });
    document.body.appendChild(b);
    setTimeout(()=>b.remove(), 1600);
  }

  // Expose a tiny namespace
  window.NewsroomTools = { formatDate, escapeHtml, copyOut };
  window.copyOut = copyOut; // convenience if you want to call directly
})();
