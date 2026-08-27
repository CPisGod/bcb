import { firebaseConfig } from "./firebase-config.js";
import { GOOGLE_MAPS_API_KEY } from "./maps-config.js";

const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
const FIREBASE_FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

(() => {
  "use strict";

  const ACTIVE_KEY = "japanTripPlanner.activeTripId";
  const THEME_KEY = "japanTripPlanner.theme";

  const CATEGORIES = {
    transport: { label: "교통", emoji: "🚃" },
    food: { label: "식사", emoji: "🍜" },
    sight: { label: "관광", emoji: "⛩️" },
    stay: { label: "숙소", emoji: "🏨" },
    shopping: { label: "쇼핑", emoji: "🛍" },
    etc: { label: "기타", emoji: "📌" },
  };

  const DEFAULT_PACKING = [
    "여권", "여권 사본 / 사진", "엔화 현금", "트래블월렛 · 신용카드",
    "유심 또는 이심(eSIM)", "보조배터리 · 충전기", "멀티 어댑터",
    "상비약", "우산 · 우비", "편한 신발", "세면도구 · 화장품",
    "카메라", "여행자보험 증서",
  ];

  const DEFAULT_TODOS = [
    "항공권 예약", "숙소 예약", "여행자보험 가입",
    "유심/이심 또는 포켓와이파이 예약", "JR패스 등 교통패스 확인",
    "엔화 환전", "Visit Japan Web 입국 정보 등록", "캐리어 준비 및 무게 확인",
  ];

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));

  // ---------- state ----------
  let trips = [];
  let activeTripId = null;
  let activeTab = "itinerary";
  let itinerarySearch = "";

  let db = null;
  let firestoreReady = false;
  let fx = null; // holds {collection, doc, setDoc, deleteDoc, onSnapshot} once the SDK loads

  function isConfigured() {
    return !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_API_KEY"));
  }

  function normalizeTrip(raw) {
    return {
      id: raw.id,
      name: raw.name || "이름 없는 여행",
      start: raw.start || "",
      end: raw.end || "",
      members: Array.isArray(raw.members) ? raw.members : [],
      rate: typeof raw.rate === "number" ? raw.rate : 9.5,
      itemsByDate: raw.itemsByDate || {},
      packing: Array.isArray(raw.packing) ? raw.packing : [],
      todos: Array.isArray(raw.todos) ? raw.todos : [],
    };
  }

  async function initFirestore() {
    activeTripId = localStorage.getItem(ACTIVE_KEY) || null;
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");

    if (!isConfigured()) {
      showFbBanner("⚠️ Firebase가 아직 설정되지 않았습니다. firebase-config.js에 프로젝트 설정값을 입력하고 다시 배포해주세요.", true);
      renderAll();
      return;
    }

    try {
      const [{ initializeApp }, firestoreMod] = await Promise.all([
        import(FIREBASE_APP_URL),
        import(FIREBASE_FIRESTORE_URL),
      ]);
      fx = firestoreMod;
      const fbApp = initializeApp(firebaseConfig);
      db = fx.getFirestore(fbApp);
      fx.onSnapshot(
        fx.collection(db, "trips"),
        (snapshot) => {
          trips = snapshot.docs.map((d) => normalizeTrip(d.data()));
          if (!trips.find((t) => t.id === activeTripId)) {
            activeTripId = trips[0] ? trips[0].id : null;
          }
          firestoreReady = true;
          hideFbBanner();
          setSyncBadge(true);
          resetSaveIndicator();
          renderAll();
        },
        (err) => {
          console.error(err);
          firestoreReady = false;
          setSyncBadge(false);
          showFbBanner("⚠️ Firebase 연결에 실패했습니다: " + err.message, true);
        }
      );
    } catch (err) {
      console.error(err);
      showFbBanner("⚠️ Firebase SDK를 불러오지 못했습니다. 인터넷 연결을 확인해주세요. (" + err.message + ")", true);
      renderAll();
    }
  }

  function ensureReady() {
    if (!firestoreReady) {
      alert("아직 Firebase에 연결되지 않았습니다. firebase-config.js 설정을 확인해주세요.");
      return false;
    }
    return true;
  }

  function persistTrip(trip) {
    if (activeTripId) localStorage.setItem(ACTIVE_KEY, activeTripId);
    if (!ensureReady()) return;
    fx.setDoc(fx.doc(db, "trips", trip.id), trip)
      .then(flashSaved)
      .catch((err) => {
        console.error(err);
        alert("저장에 실패했습니다: " + err.message);
      });
  }

  function deleteTripRemote(tripId) {
    if (!ensureReady()) return;
    fx.deleteDoc(fx.doc(db, "trips", tripId)).catch((err) => {
      console.error(err);
      alert("삭제에 실패했습니다: " + err.message);
    });
  }

  const SHARE_MSG = "모든 변경사항은 실시간으로 모든 방문자와 공유됩니다.";
  let saveFlashTimer = null;
  let flashing = false;
  function flashSaved() {
    const el = document.getElementById("saveIndicator");
    if (!el) return;
    flashing = true;
    el.textContent = "동기화됨 ✓ (" + new Date().toLocaleTimeString("ko-KR") + ")";
    clearTimeout(saveFlashTimer);
    saveFlashTimer = setTimeout(() => {
      flashing = false;
      el.textContent = SHARE_MSG;
    }, 2500);
  }
  function resetSaveIndicator() {
    if (flashing) return;
    const el = document.getElementById("saveIndicator");
    if (el) el.textContent = SHARE_MSG;
  }

  function showFbBanner(msg, isError) {
    const el = document.getElementById("fbStatusBanner");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("fb-banner-error", !!isError);
  }
  function hideFbBanner() {
    const el = document.getElementById("fbStatusBanner");
    if (el) el.hidden = true;
  }
  function setSyncBadge(on) {
    const el = document.getElementById("syncBadge");
    if (el) el.hidden = !on;
  }

  function getTrip(id) {
    return trips.find((t) => t.id === id) || null;
  }

  function activeTrip() {
    return getTrip(activeTripId);
  }

  // ---------- date helpers ----------
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDate(s) {
    const d = parseDate(s);
    return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
  }
  function dateRange(start, end) {
    const out = [];
    let cur = parseDate(start);
    const last = parseDate(end);
    if (last < cur) return out;
    while (cur <= last) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function daysUntil(dateStr) {
    const ms = parseDate(dateStr) - parseDate(todayStr());
    return Math.round(ms / 86400000);
  }

  function mapUrl(query) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  }

  function mapEmbedUrl(query) {
    return "https://www.google.com/maps?q=" + encodeURIComponent(query) + "&output=embed";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- trip factory ----------
  function createTrip({ name, start, end, members, rate }) {
    return {
      id: uid(),
      name: name || "새 여행",
      start,
      end,
      members: members || [],
      rate: rate || 9.5,
      itemsByDate: {},
      packing: DEFAULT_PACKING.map((t) => ({ id: uid(), text: t, checked: false })),
      todos: DEFAULT_TODOS.map((t) => ({ id: uid(), text: t, checked: false })),
    };
  }

  // ---------- rendering ----------
  function renderAll() {
    renderSidebar();
    const trip = activeTrip();
    const emptyState = document.getElementById("emptyState");
    const tripView = document.getElementById("tripView");
    if (!trip) {
      emptyState.hidden = false;
      tripView.hidden = true;
      document.getElementById("ddayBadge").hidden = true;
      return;
    }
    emptyState.hidden = true;
    tripView.hidden = false;
    renderDday(trip);
    renderTripHeader(trip);
    renderTabs();
    renderTabContent(trip);
  }

  function renderDday(trip) {
    const badge = document.getElementById("ddayBadge");
    if (!trip.start) { badge.hidden = true; return; }
    const n = daysUntil(trip.start);
    badge.hidden = false;
    if (n > 0) badge.textContent = `✈️ D-${n}`;
    else if (n === 0) badge.textContent = `✈️ D-Day! 출발일입니다`;
    else {
      const endN = daysUntil(trip.end);
      badge.textContent = endN >= 0 ? `🇯🇵 여행 중 (${-n}일차)` : `✅ 여행 완료`;
    }
  }

  function renderSidebar() {
    const list = document.getElementById("tripList");
    list.innerHTML = "";
    trips.forEach((t) => {
      const li = document.createElement("li");
      li.className = t.id === activeTripId ? "active" : "";
      li.innerHTML = `
        <span class="trip-item-name">${escapeHtml(t.name)}
          <span class="trip-item-dates">${t.start ? fmtDate(t.start) : "?"} ~ ${t.end ? fmtDate(t.end) : "?"}</span>
        </span>
        <button class="trip-del" title="여행 삭제" data-id="${t.id}">✕</button>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".trip-del")) return;
        activeTripId = t.id;
        localStorage.setItem(ACTIVE_KEY, activeTripId);
        renderAll();
      });
      li.querySelector(".trip-del").addEventListener("click", () => {
        if (!confirm(`"${t.name}" 여행을 삭제할까요? 모든 방문자에게서 함께 삭제되며 되돌릴 수 없습니다.`)) return;
        deleteTripRemote(t.id);
      });
      list.appendChild(li);
    });
  }

  function renderTripHeader(trip) {
    const el = document.getElementById("tripHeader");
    const nDays = trip.start && trip.end ? dateRange(trip.start, trip.end).length : 0;
    el.innerHTML = `
      <div class="trip-info">
        <h2>${escapeHtml(trip.name)}</h2>
        <div class="trip-meta">
          <span>📅 ${trip.start ? fmtDate(trip.start) : "?"} ~ ${trip.end ? fmtDate(trip.end) : "?"} (${nDays}일)</span>
          <span>👥 ${trip.members.length ? trip.members.map((m) => `<span class="member-chip">${escapeHtml(m)}</span>`).join("") : "멤버 없음"}</span>
          <span>💱 1¥ = ${trip.rate}원</span>
        </div>
      </div>
      <div class="trip-actions">
        <button class="btn btn-ghost btn-sm" id="editTripBtn">✏️ 여행 정보 수정</button>
      </div>
    `;
    el.querySelector("#editTripBtn").addEventListener("click", () => openTripModal(trip));
  }

  function renderTabs() {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
    });
  }

  function renderTabContent(trip) {
    const el = document.getElementById("tabContent");
    if (activeTab === "itinerary") return renderItinerary(el, trip);
    if (activeTab === "budget") return renderBudget(el, trip);
    if (activeTab === "packing") return renderChecklist(el, trip, "packing", "준비물");
    if (activeTab === "todo") return renderChecklist(el, trip, "todos", "할 일");
    if (activeTab === "places") return renderPlaces(el, trip);
    if (activeTab === "map") return renderMapView(el, trip);
  }

  // ---------- itinerary ----------
  function renderItinerary(el, trip) {
    const days = trip.start && trip.end ? dateRange(trip.start, trip.end) : [];
    el.innerHTML = `
      <div class="itinerary-toolbar">
        <input type="search" id="itinerarySearch" placeholder="🔍 일정 검색 (제목, 장소, 메모)" value="${escapeHtml(itinerarySearch)}">
        <button class="btn btn-primary btn-sm" id="addItemBtn">+ 일정 추가</button>
      </div>
      <div id="dayCards"></div>
    `;
    el.querySelector("#itinerarySearch").addEventListener("input", (e) => {
      itinerarySearch = e.target.value;
      renderDayCards(trip, days);
    });
    el.querySelector("#addItemBtn").addEventListener("click", () => openItemModal(trip, days[0]));
    renderDayCards(trip, days);
  }

  function renderDayCards(trip, days) {
    const wrap = document.getElementById("dayCards");
    if (!days.length) {
      wrap.innerHTML = `<div class="empty-day">여행 정보에서 출발일/도착일을 설정하면 날짜별 일정표가 생성됩니다.</div>`;
      return;
    }
    const q = itinerarySearch.trim().toLowerCase();
    wrap.innerHTML = "";
    days.forEach((date, idx) => {
      const items = (trip.itemsByDate[date] || []).slice();
      const total = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
      const card = document.createElement("div");
      card.className = "day-card";
      card.innerHTML = `
        <div class="day-card-head">
          <span class="day-title">Day ${idx + 1}</span>
          <span class="day-sub">${fmtDate(date)}</span>
          <span class="day-budget">${total ? "¥" + total.toLocaleString() : ""}</span>
          <div class="day-actions">
            <button class="btn btn-ghost btn-sm sort-time-btn">⏱ 시간순 정렬</button>
            <button class="btn btn-ghost btn-sm add-day-item-btn">+ 추가</button>
          </div>
        </div>
        <ul class="item-list"></ul>
      `;
      const ul = card.querySelector(".item-list");
      if (!items.length) {
        ul.innerHTML = `<div class="empty-day">아직 일정이 없어요.</div>`;
      } else {
        items.forEach((item, i) => {
          const matches = !q || [item.title, item.location, item.memo].join(" ").toLowerCase().includes(q);
          const li = document.createElement("li");
          li.className = "item-row" + (q && !matches ? " dimmed" : "");
          const cat = CATEGORIES[item.category] || CATEGORIES.etc;
          li.innerHTML = `
            <span class="item-time ${item.time ? "" : "empty"}">${item.time || "--:--"}</span>
            <div class="item-body">
              <div class="item-title"><span class="item-tag cat-${item.category}"><span class="cat-dot"></span>${cat.emoji} ${cat.label}</span> &nbsp;${escapeHtml(item.title)}</div>
              <div class="item-sub">
                ${item.location ? `<a href="${mapUrl(item.location)}" target="_blank" rel="noopener">📍 ${escapeHtml(item.location)}</a>` : ""}
                ${item.cost ? `<span>¥${Number(item.cost).toLocaleString()}</span>` : ""}
              </div>
              ${item.memo ? `<div class="item-memo">${escapeHtml(item.memo)}</div>` : ""}
            </div>
            <div class="item-controls">
              <button class="mini-btn up-btn" title="위로" ${i === 0 ? "disabled" : ""}>▲</button>
              <button class="mini-btn down-btn" title="아래로" ${i === items.length - 1 ? "disabled" : ""}>▼</button>
            </div>
          `;
          li.querySelector(".item-body").addEventListener("click", () => openItemModal(trip, date, item));
          li.querySelector(".up-btn").addEventListener("click", () => moveItem(trip, date, item.id, -1));
          li.querySelector(".down-btn").addEventListener("click", () => moveItem(trip, date, item.id, 1));
          ul.appendChild(li);
        });
      }
      card.querySelector(".add-day-item-btn").addEventListener("click", () => openItemModal(trip, date));
      card.querySelector(".sort-time-btn").addEventListener("click", () => {
        trip.itemsByDate[date] = (trip.itemsByDate[date] || []).slice().sort((a, b) => {
          if (!a.time) return 1;
          if (!b.time) return -1;
          return a.time.localeCompare(b.time);
        });
        persistTrip(trip);
        renderDayCards(trip, days);
      });
      wrap.appendChild(card);
    });
  }

  function moveItem(trip, date, itemId, dir) {
    const arr = trip.itemsByDate[date] || [];
    const i = arr.findIndex((x) => x.id === itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    persistTrip(trip);
    renderTabContent(trip);
  }

  // ---------- budget ----------
  function renderBudget(el, trip) {
    const days = trip.start && trip.end ? dateRange(trip.start, trip.end) : [];
    let total = 0;
    const rows = days.map((date, idx) => {
      const items = trip.itemsByDate[date] || [];
      const sum = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
      total += sum;
      return { date, idx, sum, count: items.length };
    });
    const totalKrw = Math.round(total * trip.rate);
    const perPerson = trip.members.length ? Math.round(totalKrw / trip.members.length) : null;

    el.innerHTML = `
      <div class="rate-editor">
        💱 환율(1엔 = 원):
        <input type="number" id="rateInput" value="${trip.rate}" step="0.01" min="0">
        <span>실시간 환율이 아니므로 직접 최신 환율로 조정해 주세요.</span>
      </div>
      <div class="budget-summary">
        <div class="budget-card">
          <div class="label">총 예상 경비</div>
          <div class="value">¥${total.toLocaleString()}</div>
          <div class="sub">≈ ${totalKrw.toLocaleString()}원</div>
        </div>
        <div class="budget-card">
          <div class="label">인원 수</div>
          <div class="value">${trip.members.length || "-"}</div>
          <div class="sub">${trip.members.join(", ") || "여행 정보에서 멤버를 추가하세요"}</div>
        </div>
        <div class="budget-card">
          <div class="label">1인당 예상 경비</div>
          <div class="value">${perPerson !== null ? perPerson.toLocaleString() + "원" : "-"}</div>
          <div class="sub">${perPerson !== null ? "≈ ¥" + Math.round(total / trip.members.length).toLocaleString() : ""}</div>
        </div>
      </div>
      <table class="budget-table">
        <thead><tr><th>일자</th><th>일정 수</th><th class="num">엔화(¥)</th><th class="num">원화(₩)</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>Day ${r.idx + 1} · ${fmtDate(r.date)}</td><td>${r.count}건</td><td class="num">¥${r.sum.toLocaleString()}</td><td class="num">${Math.round(r.sum * trip.rate).toLocaleString()}원</td></tr>`).join("") || `<tr><td colspan="4">일정을 추가하면 예산이 계산됩니다.</td></tr>`}
          <tr class="total-row"><td>합계</td><td>-</td><td class="num">¥${total.toLocaleString()}</td><td class="num">${totalKrw.toLocaleString()}원</td></tr>
        </tbody>
      </table>
    `;
    el.querySelector("#rateInput").addEventListener("change", (e) => {
      const v = Number(e.target.value);
      trip.rate = v > 0 ? v : trip.rate;
      persistTrip(trip);
      renderTripHeader(trip);
      renderBudget(el, trip);
    });
  }

  // ---------- checklist ----------
  function renderChecklist(el, trip, key, label) {
    const list = trip[key];
    const doneCount = list.filter((i) => i.checked).length;
    el.innerHTML = `
      <div class="checklist-add">
        <input type="text" id="checklistInput" placeholder="${label} 항목 추가하기">
        <button class="btn btn-primary btn-sm" id="checklistAddBtn">+ 추가</button>
      </div>
      <div class="checklist-progress">${doneCount} / ${list.length} 완료</div>
      <ul class="checklist" id="checklistUl"></ul>
    `;
    const ul = el.querySelector("#checklistUl");
    list.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.checked ? "checked" : "";
      li.innerHTML = `
        <input type="checkbox" ${item.checked ? "checked" : ""}>
        <span class="check-text">${escapeHtml(item.text)}</span>
        <button class="mini-btn" title="삭제">✕</button>
      `;
      li.querySelector("input").addEventListener("change", (e) => {
        item.checked = e.target.checked;
        persistTrip(trip);
        renderChecklist(el, trip, key, label);
      });
      li.querySelector(".mini-btn").addEventListener("click", () => {
        trip[key] = trip[key].filter((x) => x.id !== item.id);
        persistTrip(trip);
        renderChecklist(el, trip, key, label);
      });
      ul.appendChild(li);
    });

    const addFn = () => {
      const input = el.querySelector("#checklistInput");
      const text = input.value.trim();
      if (!text) return;
      trip[key].push({ id: uid(), text, checked: false });
      persistTrip(trip);
      renderChecklist(el, trip, key, label);
    };
    el.querySelector("#checklistAddBtn").addEventListener("click", addFn);
    el.querySelector("#checklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addFn(); }
    });
  }

  // ---------- places ----------
  function renderPlaces(el, trip) {
    const days = trip.start && trip.end ? dateRange(trip.start, trip.end) : [];
    const groups = days.map((date, idx) => {
      const items = (trip.itemsByDate[date] || []).filter((i) => i.location);
      return { date, idx, items };
    }).filter((g) => g.items.length);

    if (!groups.length) {
      el.innerHTML = `<div class="empty-day">장소가 입력된 일정이 아직 없어요. 일정 항목에 장소를 추가해보세요.</div>`;
      return;
    }
    el.innerHTML = groups.map((g) => `
      <div class="place-group">
        <h4>Day ${g.idx + 1} · ${fmtDate(g.date)}</h4>
        <div class="place-chip-list">
          ${g.items.map((it) => {
            const cat = CATEGORIES[it.category] || CATEGORIES.etc;
            return `<a class="place-chip" href="${mapUrl(it.location)}" target="_blank" rel="noopener">${cat.emoji} ${escapeHtml(it.location)}</a>`;
          }).join("")}
        </div>
      </div>
    `).join("");
  }

  // ---------- google maps (JS API, multi-pin) ----------
  const GEOCODE_CACHE_KEY = "japanTripPlanner.geocodeCache";
  let googleMapsLoadPromise = null;
  const geocodeCache = loadGeocodeCache();
  let mapViewToken = 0;

  function loadGeocodeCache() {
    try {
      return new Map(Object.entries(JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}")));
    } catch {
      return new Map();
    }
  }

  function saveGeocodeCache() {
    try {
      localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(Object.fromEntries(geocodeCache)));
    } catch {
      // localStorage 사용 불가(프라이빗 브라우징 등) 시 캐시 저장은 건너뛰고 메모리 캐시만 사용
    }
  }

  function isMapsConfigured() {
    return !!GOOGLE_MAPS_API_KEY && GOOGLE_MAPS_API_KEY !== "YOUR_GOOGLE_MAPS_API_KEY_HERE";
  }

  function loadGoogleMaps() {
    if (window.google && window.google.maps) return Promise.resolve();
    if (googleMapsLoadPromise) return googleMapsLoadPromise;
    googleMapsLoadPromise = new Promise((resolve, reject) => {
      const callbackName = "__japanTripPlannerMapsInit";
      window[callbackName] = () => {
        delete window[callbackName];
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(GOOGLE_MAPS_API_KEY) + "&callback=" + callbackName;
      script.async = true;
      script.onerror = () => reject(new Error("Google Maps 스크립트를 불러오지 못했습니다. API 키를 확인해주세요."));
      document.head.appendChild(script);
    });
    return googleMapsLoadPromise;
  }

  function geocodeLocation(geocoder, query) {
    if (geocodeCache.has(query)) return Promise.resolve(geocodeCache.get(query));
    return new Promise((resolve) => {
      geocoder.geocode({ address: query, region: "jp" }, (results, status) => {
        const loc = status === "OK" && results[0]
          ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
          : null;
        geocodeCache.set(query, loc);
        saveGeocodeCache();
        resolve(loc);
      });
    });
  }

  // ---------- map view ----------
  function renderMapView(el, trip) {
    const days = trip.start && trip.end ? dateRange(trip.start, trip.end) : [];
    const entries = [];
    days.forEach((date, idx) => {
      (trip.itemsByDate[date] || []).forEach((item) => {
        if (item.location) entries.push({ date, idx, item });
      });
    });

    if (!entries.length) {
      el.innerHTML = `<div class="empty-day">장소가 입력된 일정이 아직 없어요. 일정 항목에 장소를 추가해보세요.</div>`;
      return;
    }

    if (!isMapsConfigured()) {
      el.innerHTML = `<div class="empty-day">🗺️ 지도에 여러 장소를 함께 표시하려면 Google Maps API 키 설정이 필요해요.<br>저장소의 <code>maps-config.js</code> 파일에 안내된 절차대로 키를 발급받아 채워넣고 다시 배포해주세요.</div>`;
      return;
    }

    const myToken = ++mapViewToken;
    el.innerHTML = `
      <div id="tripMapStatus" class="map-status">지도를 불러오는 중...</div>
      <div id="tripMapCanvas" class="trip-map-canvas"></div>
    `;
    const statusEl = el.querySelector("#tripMapStatus");
    const canvasEl = el.querySelector("#tripMapCanvas");

    loadGoogleMaps().then(async () => {
      if (myToken !== mapViewToken) return;
      const geocoder = new google.maps.Geocoder();
      const map = new google.maps.Map(canvasEl, {
        center: { lat: 35.6812, lng: 139.7671 },
        zoom: 6,
      });
      const bounds = new google.maps.LatLngBounds();
      const failed = [];
      for (const entry of entries) {
        const loc = await geocodeLocation(geocoder, entry.item.location);
        if (myToken !== mapViewToken) return;
        if (!loc) {
          failed.push(entry.item.location);
          continue;
        }
        const cat = CATEGORIES[entry.item.category] || CATEGORIES.etc;
        const marker = new google.maps.Marker({
          map,
          position: loc,
          label: String(entry.idx + 1),
          title: `Day ${entry.idx + 1} · ${entry.item.location}`,
        });
        const info = new google.maps.InfoWindow({
          content: `<strong>${cat.emoji} ${escapeHtml(entry.item.title)}</strong><br>Day ${entry.idx + 1} · ${escapeHtml(entry.item.location)}`,
        });
        marker.addListener("click", () => info.open(map, marker));
        bounds.extend(loc);
      }
      if (myToken !== mapViewToken) return;
      if (!bounds.isEmpty()) map.fitBounds(bounds);
      statusEl.textContent = failed.length
        ? `⚠️ 다음 장소는 지도에서 찾지 못했어요: ${failed.join(", ")}`
        : `📍 장소 ${entries.length}곳 표시됨`;
    }).catch((err) => {
      if (myToken !== mapViewToken) return;
      statusEl.textContent = "⚠️ " + err.message;
    });
  }

  // ---------- trip modal ----------
  const tripModal = document.getElementById("tripModal");
  let editingTripId = null;

  function openTripModal(trip) {
    editingTripId = trip ? trip.id : null;
    document.getElementById("tripModalTitle").textContent = trip ? "여행 정보 수정" : "새 여행 만들기";
    document.getElementById("tripName").value = trip ? trip.name : "";
    document.getElementById("tripStart").value = trip ? trip.start : "";
    document.getElementById("tripEnd").value = trip ? trip.end : "";
    document.getElementById("tripMembers").value = trip ? trip.members.join(", ") : "";
    document.getElementById("tripRate").value = trip ? trip.rate : 9.5;
    tripModal.showModal();
  }

  document.getElementById("newTripBtn").addEventListener("click", () => {
    if (!ensureReady()) return;
    openTripModal(null);
  });
  document.getElementById("tripCancelBtn").addEventListener("click", () => tripModal.close());

  document.getElementById("tripForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("tripName").value.trim();
    const start = document.getElementById("tripStart").value;
    const end = document.getElementById("tripEnd").value;
    const members = document.getElementById("tripMembers").value.split(",").map((s) => s.trim()).filter(Boolean);
    const rate = Number(document.getElementById("tripRate").value) || 9.5;

    if (!name || !start || !end) return;
    if (parseDate(end) < parseDate(start)) {
      alert("도착일(귀국일)은 출발일보다 빠를 수 없어요.");
      return;
    }

    let t;
    if (editingTripId) {
      t = getTrip(editingTripId);
      Object.assign(t, { name, start, end, members, rate });
    } else {
      t = createTrip({ name, start, end, members, rate });
      trips.push(t);
      activeTripId = t.id;
    }
    tripModal.close();
    renderAll();
    persistTrip(t);
  });

  // ---------- item modal ----------
  const itemModal = document.getElementById("itemModal");
  const itemLocationInput = document.getElementById("itemLocation");
  const itemMapPreview = document.getElementById("itemMapPreview");
  const itemMapFrame = document.getElementById("itemMapFrame");
  let editingItem = null; // { date, id } or null
  let itemModalTrip = null;
  let mapPreviewTimer = null;

  function updateItemMapPreview(query) {
    const q = query.trim();
    if (!q) {
      itemMapPreview.hidden = true;
      itemMapFrame.src = "";
      return;
    }
    itemMapFrame.src = mapEmbedUrl(q);
    itemMapPreview.hidden = false;
  }

  itemLocationInput.addEventListener("input", () => {
    clearTimeout(mapPreviewTimer);
    mapPreviewTimer = setTimeout(() => updateItemMapPreview(itemLocationInput.value), 500);
  });

  function openItemModal(trip, defaultDate, item) {
    itemModalTrip = trip;
    editingItem = item ? { date: findItemDate(trip, item.id), id: item.id } : null;
    const days = trip.start && trip.end ? dateRange(trip.start, trip.end) : [];
    const dateSelect = document.getElementById("itemDate");
    dateSelect.innerHTML = days.map((d, i) => `<option value="${d}">Day ${i + 1} · ${fmtDate(d)}</option>`).join("");
    if (!days.length) {
      alert("먼저 여행 정보에서 출발일/도착일을 설정해주세요.");
      return;
    }

    document.getElementById("itemModalTitle").textContent = item ? "일정 수정" : "일정 추가";
    dateSelect.value = item ? editingItem.date : (defaultDate || days[0]);
    document.getElementById("itemTime").value = item ? item.time || "" : "";
    document.getElementById("itemTitle").value = item ? item.title : "";
    document.getElementById("itemCategory").value = item ? item.category : "sight";
    document.getElementById("itemCost").value = item ? item.cost || "" : "";
    itemLocationInput.value = item ? item.location || "" : "";
    updateItemMapPreview(itemLocationInput.value);
    document.getElementById("itemMemo").value = item ? item.memo || "" : "";
    document.getElementById("itemDeleteBtn").hidden = !item;
    itemModal.showModal();
  }

  function findItemDate(trip, itemId) {
    for (const date of Object.keys(trip.itemsByDate)) {
      if (trip.itemsByDate[date].some((x) => x.id === itemId)) return date;
    }
    return null;
  }

  document.getElementById("itemCancelBtn").addEventListener("click", () => itemModal.close());

  itemModal.addEventListener("close", () => {
    clearTimeout(mapPreviewTimer);
    itemMapFrame.src = "";
  });

  document.getElementById("itemDeleteBtn").addEventListener("click", () => {
    if (!editingItem) return;
    const trip = itemModalTrip;
    trip.itemsByDate[editingItem.date] = (trip.itemsByDate[editingItem.date] || []).filter((x) => x.id !== editingItem.id);
    itemModal.close();
    renderTabContent(trip);
    persistTrip(trip);
  });

  document.getElementById("itemForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const trip = itemModalTrip;
    const date = document.getElementById("itemDate").value;
    const data = {
      time: document.getElementById("itemTime").value,
      title: document.getElementById("itemTitle").value.trim(),
      category: document.getElementById("itemCategory").value,
      cost: Number(document.getElementById("itemCost").value) || 0,
      location: document.getElementById("itemLocation").value.trim(),
      memo: document.getElementById("itemMemo").value.trim(),
    };
    if (!data.title) return;

    if (!trip.itemsByDate[date]) trip.itemsByDate[date] = [];

    if (editingItem) {
      // remove from old date if moved
      trip.itemsByDate[editingItem.date] = (trip.itemsByDate[editingItem.date] || []).filter((x) => x.id !== editingItem.id);
      trip.itemsByDate[date].push({ id: editingItem.id, ...data });
    } else {
      trip.itemsByDate[date].push({ id: uid(), ...data });
    }
    itemModal.close();
    renderTabContent(trip);
    persistTrip(trip);
  });

  // ---------- tabs ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      renderTabs();
      renderTabContent(activeTrip());
    });
  });

  // ---------- export / import ----------
  document.getElementById("exportBtn").addEventListener("click", () => {
    const trip = activeTrip();
    const payload = trip ? trip : { trips };
    const filename = trip ? `${trip.name || "일본여행"}.json` : "japan-trip-planner-backup.json";
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ensureReady()) { e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data.trips) ? data.trips : [data];
        const added = [];
        incoming.forEach((t) => {
          if (!t || !t.name) return;
          t.id = uid(); // avoid collisions, always import as new trip(s)
          t.itemsByDate = t.itemsByDate || {};
          t.packing = t.packing || [];
          t.todos = t.todos || [];
          t.members = t.members || [];
          t.rate = t.rate || 9.5;
          trips.push(t);
          added.push(t);
        });
        if (added.length) {
          activeTripId = added[added.length - 1].id;
          renderAll();
          added.forEach(persistTrip);
          alert("불러오기가 완료되었습니다! (모든 방문자와 공유됩니다)");
        }
      } catch (err) {
        alert("파일을 읽을 수 없습니다. 올바른 JSON 파일인지 확인해주세요.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- print ----------
  document.getElementById("printBtn").addEventListener("click", () => {
    if (!activeTrip()) { alert("먼저 여행을 선택하거나 만들어주세요."); return; }
    if (activeTab !== "itinerary") {
      activeTab = "itinerary";
      renderTabs();
      renderTabContent(activeTrip());
    }
    window.print();
  });

  // ---------- theme ----------
  document.getElementById("darkToggleBtn").addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem(THEME_KEY, "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem(THEME_KEY, "dark");
    }
  });

  // ---------- init ----------
  initFirestore();
})();
