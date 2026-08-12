/* VentaBox · Panel de consulta remota (solo lectura) */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) { return "$ " + Number(v || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fmt = function (v) { return Number(v || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 }); };
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  var state = {
    token: localStorage.getItem("vb_token") || null,
    exp: Number(localStorage.getItem("vb_exp") || 0),
    products: [],
    store: [],
    warehouse: [],
    today: null,
    offline: false,
  };

  /* ---------------- Caché local (modo sin conexión) ---------------- */

  var CACHE_KEY = "vb_cache";
  var SALES_KEY = "vb_sales_cache";
  var MAX_SALES_DATES = 40;

  function saveCache() {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        products: state.products,
        store: state.store,
        warehouse: state.warehouse,
        today: state.today,
      }));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function loadCache() {
    try {
      var c = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
      return c && c.products ? c : null;
    } catch (e) { return null; }
  }

  function saveSalesCache(date, win) {
    try {
      var all = JSON.parse(window.localStorage.getItem(SALES_KEY) || "{}");
      all[date] = { savedAt: Date.now(), win: win };
      var keys = Object.keys(all).sort();
      while (keys.length > MAX_SALES_DATES) delete all[keys.shift()];
      window.localStorage.setItem(SALES_KEY, JSON.stringify(all));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function salesCacheFor(date) {
    try {
      var all = JSON.parse(window.localStorage.getItem(SALES_KEY) || "{}");
      return all[date] ? all[date].win : null;
    } catch (e) { return null; }
  }

  function setSyncLabel(text, offline) {
    $("lastSync").textContent = text;
    var banner = $("offlineBanner");
    if (banner) banner.classList.toggle("hidden", !offline);
    state.offline = !!offline;
  }

  var byId = {};
  function indexProducts() {
    byId = {};
    state.products.forEach(function (p) { byId[p.id] = p; });
  }
  function nameOf(pid) {
    var p = byId[pid];
    return p ? p.nombre : ("Producto #" + pid);
  }
  function productOf(pid) {
    var p = byId[pid];
    return p || { categoria: "", precio_unitario: 0, nombre: "", unidad_medida: "Unidades", stock_minimo: 0, cantidad_general: 0, activo: 1 };
  }

  function show(view) {
    $("loginView").classList.toggle("hidden", view !== "login");
    $("homeView").classList.toggle("hidden", view !== "home");
  }

  function toastError(msg) {
    var el = $("loginError");
    if (el) el.textContent = msg;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function requireToken() {
    if (state.token && Date.now() / 1000 < state.exp) return;
    state.token = null;
    window.localStorage.removeItem("vb_token");
    window.localStorage.removeItem("vb_exp");
    show("login");
    throw new Error("Sesión requerida");
  }

  async function api(body) {
    if (!FUNCTION_URL) {
      throw new Error("Panel sin configurar: edita panel/config.js");
    }
    var headers = { "Content-Type": "application/json" };
    if (typeof ANON_KEY !== "undefined" && ANON_KEY) {
      headers["Authorization"] = "Bearer " + ANON_KEY;
    }
    var res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Error de servidor (" + res.status + ")");
    return data;
  }

  async function query(table, qs) {
    requireToken();
    var rows = await api({ action: "query", token: state.token, table: table, qs: qs });
    return rows || [];
  }

  /* ---------------- Login ---------------- */

  async function doLogin() {
    var pin = $("pinInput").value.trim();
    if (!pin) return;
    var btn = $("loginBtn");
    btn.disabled = true;
    btn.textContent = "Verificando...";
    toastError("");
    try {
      var res = await api({ action: "login", pin: pin });
      state.token = res.token;
      state.exp = Number(res.exp);
      window.localStorage.setItem("vb_token", state.token);
      window.localStorage.setItem("vb_exp", String(state.exp));
      $("pinInput").value = "";
      enterHome();
    } catch (e) {
      toastError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  }

  /* ---------------- Datos ---------------- */

  async function loadAll() {
    try {
      var parts = await Promise.all([
        query("products", "select=id,nombre,categoria,precio_unitario,cantidad_general,unidad_medida,stock_minimo,activo&order=nombre"),
        query("store_inventory", "select=product_id,cantidad,stock_minimo,precio_venta,unidad_medida,origen_almacen"),
        query("warehouse_inventory", "select=product_id,warehouse_id,cantidad"),
      ]);
      state.products = parts[0];
      state.store = parts[1];
      state.warehouse = parts[2];
      indexProducts();
      fillCategories();
      setSyncLabel("Actualizado: " + new Date().toLocaleTimeString("es-ES"), false);
      saveCache();
      renderDashboard();
      renderInventory($("searchInv").value, $("catFilter").value);
    } catch (e) {
      if (e.message.indexOf("Sesión") !== -1) return show("login");
      var cache = loadCache();
      if (!cache) return toastError(e.message);
      state.products = cache.products;
      state.store = cache.store;
      state.warehouse = cache.warehouse;
      state.today = cache.today || null;
      indexProducts();
      fillCategories();
      setSyncLabel("Sin conexión · datos guardados el " + new Date(cache.savedAt).toLocaleString("es-ES"), true);
      renderDashboard();
      renderInventory($("searchInv").value, $("catFilter").value);
    }
  }

  function storeOf(pid) {
    var s = null;
    for (var i = 0; i < state.store.length; i++) {
      if (state.store[i].product_id === pid) { s = state.store[i]; break; }
    }
    return s;
  }

  function stockOf(p) {
    var s = storeOf(p.id);
    return s ? Number(s.cantidad) : Number(p.cantidad_general || 0);
  }

  function fillCategories() {
    var sel = $("catFilter");
    var cats = [];
    state.products.forEach(function (p) {
      var c = String(p.categoria || "").trim();
      if (c && cats.indexOf(c) === -1) cats.push(c);
    });
    cats.sort(function (a, b) { return a.localeCompare(b, "es"); });
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
  }

  /* ---------------- Dashboard ---------------- */

  function lowStockProducts() {
    return state.products.filter(function (p) {
      if (p.activo !== 1) return false;
      return p.stock_minimo > 0 && stockOf(p) <= p.stock_minimo;
    });
  }

  function inventoryTotals() {
    var valStore = 0, valWh = 0, valOther = 0;
    var unitsStore = 0, unitsWh = 0, unitsOther = 0;
    state.store.forEach(function (s) {
      valStore += (Number(s.cantidad) || 0) * (Number(s.precio_venta) || 0);
      unitsStore += Number(s.cantidad) || 0;
    });
    state.warehouse.forEach(function (w) {
      var p = productOf(w.product_id);
      valWh += (Number(w.cantidad) || 0) * (Number(p.precio_unitario) || 0);
      unitsWh += Number(w.cantidad) || 0;
    });
    state.products.forEach(function (p) {
      if (p.activo !== 1) return;
      valOther += (Number(p.cantidad_general) || 0) * (Number(p.precio_unitario) || 0);
      unitsOther += Number(p.cantidad_general) || 0;
    });
    var countWh = {};
    state.warehouse.forEach(function (w) { countWh[w.product_id] = true; });
    return {
      valStore: valStore, valWh: valWh, valOther: valOther,
      unitsStore: Math.round(unitsStore), unitsWh: Math.round(unitsWh), unitsOther: Math.round(unitsOther),
      totalValue: valStore + valWh + valOther,
      active: state.products.filter(function (p) { return p.activo === 1; }).length,
      prodWh: Object.keys(countWh).length,
      storeLines: state.store.length,
    };
  }

  function kpi(label, value, cls) {
    return '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="value ' + (cls || "") + '">' + value + "</div></div>";
  }

  function renderDashboard() {
    var t = inventoryTotals();
    var bajo = lowStockProducts();
    var hoy = state.today;

    $("kpis").innerHTML =
      kpi("Valor inventario", money(t.totalValue)) +
      kpi("En tienda", t.storeLines + " productos") +
      kpi("En almacén", t.prodWh + " productos") +
      kpi("Ventas hoy", money(hoy ? hoy.total : 0)) +
      kpi("Ganancia neta hoy", money(hoy ? hoy.ganancia : 0), hoy && hoy.ganancia > 0 ? "success" : "") +
      kpi("Stock bajo", String(bajo.length), bajo.length ? "danger" : "success");

    var panel = $("tab-dashboard");
    var html =
      '<p class="section-title">Desglose de inventario</p>' +
      '<div class="item"><div class="name">Valor inventario tienda</div><div class="right"><span class="amount">' + money(t.valStore) + "</span></div></div>" +
      '<div class="item"><div class="name">Valor inventario almacén</div><div class="right"><span class="amount">' + money(t.valWh) + "</span></div></div>" +
      '<div class="item"><div class="name">Valor inventario general</div><div class="right"><span class="amount">' + money(t.valOther) + "</span></div></div>" +
      '<div class="item"><div class="name">Productos activos</div><div class="right"><span class="amount">' + t.active + "</span></div></div>" +
      '<div class="item"><div class="name">En tienda</div><div class="right"><span class="amount">' + t.storeLines + " líneas · " + fmt(t.unitsStore) + " uds</span></div></div>" +
      '<div class="item"><div class="name">En almacén</div><div class="right"><span class="amount">' + t.prodWh + " productos · " + fmt(t.unitsWh) + " uds</span></div></div>";

    if (hoy) {
      html += '<p class="section-title">Ventas de hoy</p>' +
        '<div class="item"><div class="name">Total vendido</div><div class="right"><span class="amount">' + money(hoy.total) + "</span></div></div>" +
        '<div class="item"><div class="name">Ganancia neta del día</div><div class="right"><span class="amount success">' + money(hoy.ganancia) + "</span></div></div>" +
        '<div class="item"><div class="name">Dinero en caja (efectivo)</div><div class="right"><span class="amount">' + money(hoy.efectivo) + "</span></div></div>" +
        '<div class="item"><div class="name">Transferencias</div><div class="right"><span class="amount">' + money(hoy.transferencia) + "</span></div></div>" +
        '<div class="item"><div class="name">Ticket(s) del día</div><div class="right"><span class="amount">' + (hoy.sales ? hoy.sales.length : 0) + "</span></div></div>";
    }

    panel.innerHTML = html;

    if (bajo.length) {
      panel.innerHTML += '<p class="section-title">Productos por reponer</p>';
      bajo.slice(0, 8).forEach(function (p) {
        panel.innerHTML +=
          '<div class="item"><div class="name">' + esc(p.nombre) +
          '<div class="sub">Stock mínimo: ' + fmt(p.stock_minimo) + " " + esc(p.unidad_medida) + "</div></div>" +
          '<div class="right"><span class="badge-stock badge-low">' + fmt(stockOf(p)) + " " + esc(p.unidad_medida) + "</span></div></div>";
      });
    } else {
      panel.innerHTML += '<p class="section-title">Todo el inventario está en nivel óptimo</p>';
    }
  }

  /* ---------------- Inventario ---------------- */

  function renderInventory(search, cat) {
    var list = $("inventoryList");
    search = (search || "").toLowerCase();
    cat = cat || "";
    var rows = state.products.filter(function (p) {
      if (p.activo !== 1) return false;
      if (cat && String(p.categoria || "") !== cat) return false;
      if (search && String(p.nombre).toLowerCase().indexOf(search) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });

    if (!rows.length) {
      list.innerHTML = '<div class="spinner">Sin resultados</div>';
      return;
    }

    list.innerHTML = "";
    rows.forEach(function (p) {
      var s = storeOf(p.id);
      var tienda = s ? Number(s.cantidad) : 0;
      var bajo = p.stock_minimo > 0 && tienda <= p.stock_minimo;
      var precio = s && s.precio_venta ? s.precio_venta : p.precio_unitario;
      var whQty = 0;
      state.warehouse.forEach(function (w) { if (w.product_id === p.id) whQty += Number(w.cantidad) || 0; });
      var el = document.createElement("div");
      el.className = "item";
      el.innerHTML =
        '<div class="name">' + esc(p.nombre) +
        (p.categoria ? '<div class="sub">' + esc(p.categoria) + "</div>" : "") +
        '<div class="sub">Precio venta: ' + money(precio) +
        (s && s.origen_almacen ? " · " + esc(s.origen_almacen) : "") + "</div></div>" +
        '<div class="right"><span class="badge-stock ' + (bajo ? "badge-low" : "badge-ok") + '">' +
        fmt(tienda) + " " + esc(p.unidad_medida) + "</span>" +
        '<div class="sub">General: ' + fmt(p.cantidad_general) + " · Almacén: " + fmt(whQty) + "</div></div>";
      list.appendChild(el);
    });
  }

  /* ---------------- Ventas ---------------- */

  /* Suma días a una fecha "YYYY-MM-DD" sin depender de la zona horaria
     del navegador (el cálculo se hace en UTC). */
  function addDays(dateStr, n) {
    var parts = String(dateStr).split("-");
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    var dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }

  async function daySales(date) {
    requireToken();
    if (state.offline) {
      var cached = salesCacheFor(date);
      if (cached) return cached;
      throw new Error("Sin conexión: no hay datos guardados para esta fecha");
    }
    var nextStr = addDays(date, 1);
    var sales = await query("sales",
      "select=id,total,dependiente,modo_pago,monto_efectivo,monto_transferencia,created_at" +
      "&created_at=gte." + date + "&created_at=lt." + nextStr +
      "&order=created_at.desc&limit=500");

    var win = { sales: sales, total: 0, ganancia: 0, efectivo: 0, transferencia: 0 };
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      win.total += Number(s.total) || 0;
      win.efectivo += Number(s.monto_efectivo) || 0;
      win.transferencia += Number(s.monto_transferencia) || 0;
      var items = await query("sale_items",
        "select=product_id,cantidad,precio_unitario,subtotal,ganancia&sale_id=eq." + s.id);
      items.forEach(function (it) { win.ganancia += Number(it.ganancia) || 0; });
      s.items = items.map(function (it) {
        it.nombre = nameOf(it.product_id);
        return it;
      });
    }
    return win;
  }

  async function renderSales(date) {
    var list = $("salesList");
    list.innerHTML = '<div class="spinner">Cargando ventas...</div>';
    try {
      var win = await daySales(date);
      saveSalesCache(date, win);
      if (!win.sales.length) {
        list.innerHTML = '<div class="spinner">No hay ventas este día</div>';
        return;
      }
      var html =
        '<div class="card"><div class="name">Total del día</div>' +
        '<div class="right" style="text-align:right"><span class="amount" style="font-size:20px">' + money(win.total) + "</span></div>" +
        '<div class="sub">' + win.sales.length + ' ticket(s) · Ganancia: <span class="success">' + money(win.ganancia) + "</span></div></div>";

      win.sales.forEach(function (s) {
        var itemsHtml = s.items.map(function (i) {
          return '<div class="sub">' + fmt(i.cantidad) + " × " + money(i.precio_unitario) + " — <b>" + esc(i.nombre) +
            "</b>" + (Number(i.ganancia) ? ' <span style="color:var(--success)">(+' + money(i.ganancia) + ")</span>" : "") + "</div>";
        }).join("");
        html +=
          '<div class="item" style="align-items:flex-start"><div style="flex:1;min-width:0"><div class="name">Ticket #' + s.id +
          '<span class="tag" style="margin-left:6px">' + esc(s.modo_pago || "efectivo") + "</span></div>" +
          '<div class="sub">' + esc(s.dependiente || "—") + " · " + esc(s.created_at) + "</div>" + itemsHtml +
          '</div><div class="right" style="flex-shrink:0"><span class="amount">' + money(s.total) + "</span></div></div>";
      });
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<div class="error">' + esc(e.message) + "</div>";
      if (e.message.indexOf("Sesión") !== -1) show("login");
    }
  }

  /* ---------------- Reporte PDF ---------------- */

  async function doReport(date) {
    var btn = $("reportBtn");
    var status = $("reportStatus");
    btn.disabled = true;
    status.textContent = "Generando reporte...";
    try {
      var win = await daySales(date);
      var now = new Date().toLocaleString("es-ES");
      var h =
        '<h1>Reporte de ventas · VentaBox</h1>' +
        '<p class="r-sub">Fecha: <b>' + date + "</b> &nbsp;·&nbsp; Generado: " + now + "</p>" +
        '<table class="r-summary">' +
        "<tr><td>Total vendido</td><td>" + money(win.total) + "</td></tr>" +
        "<tr><td>Ganancia neta del día</td><td>" + money(win.ganancia) + "</td></tr>" +
        "<tr><td>Dinero en caja (efectivo)</td><td>" + money(win.efectivo) + "</td></tr>" +
        "<tr><td>Transferencias</td><td>" + money(win.transferencia) + "</td></tr>" +
        "<tr><td>Nº de tickets</td><td>" + win.sales.length + "</td></tr>" +
        "</table>";

      if (win.sales.length) {
        h += "<h2>Detalle de ventas</h2>";
        win.sales.forEach(function (s) {
          var rows = s.items.map(function (i) {
            return "<tr><td>" + esc(i.nombre) + "</td><td>" + fmt(i.cantidad) + "</td><td>" + money(i.precio_unitario) + "</td><td>" + money(i.subtotal) + "</td></tr>";
          }).join("");
          h +=
            '<div class="ticket"><div class="t-head">Ticket #' + s.id + " · " + esc(s.created_at) +
            " · " + esc(s.modo_pago || "efectivo") + " · " + esc(s.dependiente || "—") + "</div>" +
            '<table class="r-items"><tr><th>Producto</th><th>Cant.</th><th>P.Unit.</th><th>Subtotal</th></tr>' +
            rows + '<tr class="t-total"><td colspan="3">Total</td><td>' + money(s.total) + "</td></tr></table></div>";
        });
      } else {
        h += '<p class="period">No hubo ventas este día.</p>';
      }

      h += '<div class="r-firmas"><div>Firma del gerente: ____________________</div><div>Firma del cajero: ____________________</div></div>';

      $("printArea").innerHTML = h;
      window.print();
    } catch (e) {
      status.textContent = "Error: " + e.message;
      if (e.message.indexOf("Sesión") !== -1) show("login");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- Flujo ---------------- */

  function enterHome() {
    toastError("");
    show("home");
    $("salesDate").value = todayStr();
    $("reportDate").value = todayStr();
    $("catFilter").value = "";
    $("searchInv").value = "";
    loadAll();
    daySales(todayStr()).then(function (win) {
      state.today = win;
      saveSalesCache(todayStr(), win);
      saveCache();
      renderDashboard();
    }).catch(function () {
      var cached = salesCacheFor(todayStr());
      if (cached) { state.today = cached; renderDashboard(); }
    });
  }

  function logout() {
    state.token = null;
    window.localStorage.removeItem("vb_token");
    window.localStorage.removeItem("vb_exp");
    show("login");
  }

  /* ---------------- Eventos ---------------- */

  $("loginBtn").addEventListener("click", doLogin);
  $("pinInput").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("logoutBtn").addEventListener("click", logout);

  $("searchInv").addEventListener("input", function (e) { renderInventory(e.target.value, $("catFilter").value); });
  $("catFilter").addEventListener("change", function (e) { renderInventory($("searchInv").value, e.target.value); });
  $("salesDate").addEventListener("change", function (e) { renderSales(e.target.value); });
  $("reportBtn").addEventListener("click", function () { doReport($("reportDate").value || todayStr()); });

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      var name = tab.dataset.tab;
      ["dashboard", "inventory", "sales", "report"].forEach(function (t) {
        $("tab-" + t).classList.toggle("hidden", t !== name);
      });
      if (name === "inventory") renderInventory($("searchInv").value, $("catFilter").value);
      if (name === "sales") renderSales($("salesDate").value || todayStr());
    });
  });

  /* ---------------- Reconexión ---------------- */

  window.addEventListener("offline", function () {
    if ($("homeView").classList.contains("hidden")) return;
    setSyncLabel("Sin conexión · mostrando la última información guardada", true);
  });

  window.addEventListener("online", function () {
    if ($("homeView").classList.contains("hidden")) return;
    var date = $("salesDate").value || todayStr();
    loadAll();
    daySales(date).then(function (win) {
      state.today = win;
      saveSalesCache(date, win);
      saveCache();
      renderDashboard();
      if (!$("tab-sales").classList.contains("hidden")) renderSales(date);
    }).catch(function () {});
  });

  /* ---------------- Inicio ---------------- */

  if (state.token && Date.now() / 1000 < state.exp) {
    enterHome();
  } else {
    show("login");
  }
})();