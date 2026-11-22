
/*******************************************************
 * NICHA ADS PRO
 * FILE: assets/js/app.js
 * VERSION: 1.2.2
 *
 * Frontend + Google Apps Script API
 *
 * ระบบ:
 * 1. Dashboard
 * 2. Campaign Management
 * 3. Google Sheets Database
 * 4. AI Analysis Preparation
 * 5. Owner Approval Workflow
 * 6. Budget Overview
 * 7. Mobile Navigation
 *
 * หมายเหตุ:
 * - POST ส่งคำสั่งเพียงครั้งเดียว
 * - ใช้ GET/JSONP ตรวจสอบผลจาก Google Sheets
 * - ยังไม่เชื่อม AI API จริง
 * - ยังไม่เชื่อม Meta Ads / Google Ads
 * - ยังไม่มีการยิงโฆษณาจริง
 *******************************************************/

'use strict';

/* =====================================================
   1. CONFIGURATION
===================================================== */

const NICHA_ADS = {
  version: '1.2.2',

  apiUrl:
    'https://script.google.com/macros/s/AKfycbzuezJjKGLvKe-5APlnuH6fl6F1HQLeN7tV5_qAvNTK1BsXOo4S_KIQPA_N8sLRR80o/exec',

  pageKey: 'NICHA_ADS_PRO_LAST_PAGE',

  requestTimeout: 20000,
  verifyAttempts: 6,
  verifyDelay: 1200
};

let campaignCache = [];
let dashboardCache = null;
let apiBusy = false;

/* =====================================================
   2. COMMON FUNCTIONS
===================================================== */

function $(selector, parent = document) {
  return parent.querySelector(selector);
}

function $all(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('th-TH', {
    maximumFractionDigits: 2
  }) + ' ฿';
}

function todayText() {
  return new Date().toLocaleDateString('th-TH');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showMessage(element, message, type = 'info') {
  if (!element) return;

  element.textContent = message;
  element.className = 'message ' + type;
  element.style.display = 'block';
}

function setButtonLoading(button, loading, originalText) {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'กำลังดำเนินการ...';
  } else {
    button.disabled = false;
    button.textContent =
      originalText || button.dataset.originalText || 'ดำเนินการ';
  }
}

function normalizeCampaign(item) {
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    platform: String(item.platform || ''),
    goal: String(item.goal || ''),
    targetArea: String(item.targetArea || ''),
    audience: String(item.audience || ''),
    service: String(item.service || ''),
    offer: String(item.offer || ''),
    dailyBudget: Number(item.dailyBudget || 0),
    budget: Number(item.budget || 0),
    days: Number(item.days || 0),
    status: String(item.status || 'draft').toLowerCase(),
    aiScore: item.aiScore ?? null,
    aiRecommendation: String(item.aiRecommendation || ''),
    ownerApproval: String(item.ownerApproval || ''),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || '')
  };
}

/* =====================================================
   3. GOOGLE APPS SCRIPT API - GET / JSONP
===================================================== */

/**
 * ใช้ JSONP สำหรับ GET
 * ลดปัญหา CORS ระหว่าง GitHub Pages กับ Apps Script
 */
function apiGet(action) {
  return new Promise((resolve, reject) => {
    const callbackName =
      'nichaAdsCallback_' +
      Date.now() +
      '_' +
      Math.floor(Math.random() * 100000);

    const script = document.createElement('script');

    let finished = false;

    const cleanup = () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }

      try {
        delete window[callbackName];
      } catch (error) {
        window[callbackName] = undefined;
      }

      clearTimeout(timeout);
    };

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;
      cleanup();

      reject(new Error(
        'เชื่อมต่อ Google Apps Script ไม่สำเร็จ กรุณาตรวจสอบการเข้าสู่ระบบ Google'
      ));
    }, NICHA_ADS.requestTimeout);

    window[callbackName] = data => {
      if (finished) return;

      finished = true;
      cleanup();

      if (!data || data.success === false) {
        reject(new Error(
          data?.message || 'ระบบ API ส่งข้อมูลกลับมาไม่สำเร็จ'
        ));
        return;
      }

      resolve(data);
    };

    const separator =
      NICHA_ADS.apiUrl.includes('?') ? '&' : '?';

    script.src =
      NICHA_ADS.apiUrl +
      separator +
      'action=' + encodeURIComponent(action) +
      '&callback=' + encodeURIComponent(callbackName) +
      '&_=' + Date.now();

    script.onerror = () => {
      if (finished) return;

      finished = true;
      cleanup();

      reject(new Error(
        'ไม่สามารถโหลดข้อมูลจาก Google Apps Script ได้'
      ));
    };

    document.head.appendChild(script);
  });
}

/* =====================================================
   4. GOOGLE APPS SCRIPT API - POST
===================================================== */

/**
 * ส่ง POST แบบ no-cors
 *
 * หมายเหตุ:
 * เบราว์เซอร์จะไม่เปิดเผยเนื้อหาคำตอบ POST
 * ดังนั้นต้องตรวจสอบผลด้วย GET อีกครั้ง
 *
 * ห้ามส่ง POST ซ้ำเพียงเพราะอ่านคำตอบไม่ได้
 */
async function apiPost(payload) {
  const response = await fetch(NICHA_ADS.apiUrl, {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'include',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8'
    },
    body: JSON.stringify(payload)
  });

  return {
    dispatched: true,
    opaque: response.type === 'opaque'
  };
}

/**
 * ตรวจสอบรายการแคมเปญจาก Google Sheets
 */
async function fetchCampaignsFromServer() {
  const result = await apiGet('campaigns');

  const campaigns = Array.isArray(result.campaigns)
    ? result.campaigns.map(normalizeCampaign)
    : [];

  return campaigns;
}

/**
 * โหลดแคมเปญและอัปเดตหน้าจอ
 */
async function loadCampaigns(options = {}) {
  const silent = options.silent === true;

  try {
    const campaigns = await fetchCampaignsFromServer();

    campaignCache = campaigns;

    renderCampaigns();
    updateDashboardDisplay();

    console.log(
      'Loaded campaigns from Google Sheets:',
      campaigns.length
    );

    return campaigns;

  } catch (error) {
    console.error('Load campaigns error:', error);

    if (!silent) {
      alert(
        'ไม่สามารถโหลดข้อมูลแคมเปญได้\n\n' +
        error.message
      );
    }

    throw error;
  }
}

/**
 * โหลด Dashboard จาก Apps Script
 */
async function loadDashboard(options = {}) {
  const silent = options.silent === true;

  try {
    const result = await apiGet('dashboard');

    dashboardCache = result.dashboard || {};

    updateDashboardDisplay();

    return dashboardCache;

  } catch (error) {
    console.error('Load dashboard error:', error);

    if (!silent) {
      console.warn('Dashboard API unavailable:', error.message);
    }

    return null;
  }
}

/**
 * ตรวจสอบผลการทำงานด้วย GET
 *
 * ไม่ส่ง POST ซ้ำ
 * ตรวจสอบเฉพาะข้อมูลที่ต้องการให้เปลี่ยน
 */
async function verifyServerChange(verifier) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= NICHA_ADS.verifyAttempts;
    attempt++
  ) {
    await sleep(NICHA_ADS.verifyDelay);

    try {
      const campaigns = await fetchCampaignsFromServer();

      campaignCache = campaigns;
      renderCampaigns();
      updateDashboardDisplay();

      const matched = verifier(campaigns);

      if (matched) {
        return {
          success: true,
          campaigns,
          matched
        };
      }

    } catch (error) {
      lastError = error;
      console.warn(
        'Verification attempt ' + attempt + ':',
        error.message
      );
    }
  }

  return {
    success: false,
    campaigns: campaignCache,
    error: lastError
  };
}

/* =====================================================
   5. NAVIGATION
===================================================== */

const pageTitles = {
  dashboard: 'Dashboard',
  analysis: 'AI วิเคราะห์โฆษณา',
  campaigns: 'จัดการแคมเปญ',
  budget: 'จัดการงบประมาณ',
  creative: 'Creative Studio',
  customers: 'Customer Management',
  analytics: 'Analytics & Reports',
  approvals: 'Approval Center',
  settings: 'Settings'
};

function showPage(pageName) {
  const sections = $all('.page-section');

  let found = false;

  sections.forEach(section => {
    const sectionId = section.id || '';
    const sectionPage = section.dataset.pageSection || '';

    const matches =
      sectionPage === pageName ||
      sectionId === pageName ||
      sectionId === 'page-' + pageName ||
      sectionId === pageName + '-page';

    section.classList.toggle('active', matches);

    if (matches) found = true;
  });

  if (!found) {
    console.warn('Page section not found:', pageName);
  }

  $all('.nav-item[data-page]').forEach(item => {
    const active = item.dataset.page === pageName;

    item.classList.toggle('active', active);

    if (active) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  const title = $('#breadcrumbTitle');

  if (title) {
    title.textContent = pageTitles[pageName] || pageName;
  }

  try {
    localStorage.setItem(NICHA_ADS.pageKey, pageName);
  } catch (error) {
    console.warn('Cannot save current page.');
  }

  closeMobileSidebar();

  if (pageName === 'campaigns' || pageName === 'approvals') {
    loadCampaigns({ silent: true }).catch(() => {});
  }

  if (pageName === 'dashboard' || pageName === 'budget') {
    loadDashboard({ silent: true });
  }
}

function closeMobileSidebar() {
  const sidebar = $('#sidebar');

  if (sidebar) {
    sidebar.classList.remove('open');
  }
}

function setupNavigation() {
  $all('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      showPage(item.dataset.page);
    });
  });

  $all('[data-goto]').forEach(button => {
    button.addEventListener('click', () => {
      showPage(button.dataset.goto);
    });
  });

  const mobileMenu = $('#mobileMenu');

  if (mobileMenu) {
    mobileMenu.addEventListener('click', () => {
      const sidebar = $('#sidebar');

      if (sidebar) {
        sidebar.classList.toggle('open');
      }
    });
  }

  document.addEventListener('click', event => {
    const sidebar = $('#sidebar');
    const mobileMenuButton = $('#mobileMenu');

    if (!sidebar || !mobileMenuButton) return;

    const isMobile = window.innerWidth <= 900;

    if (
      isMobile &&
      sidebar.classList.contains('open') &&
      !sidebar.contains(event.target) &&
      !mobileMenuButton.contains(event.target)
    ) {
      closeMobileSidebar();
    }
  });

  let savedPage = 'dashboard';

  try {
    savedPage =
      localStorage.getItem(NICHA_ADS.pageKey) || 'dashboard';
  } catch (error) {
    savedPage = 'dashboard';
  }

  const hasSavedPage =
    $(`.page-section#${savedPage}`) ||
    $(`.page-section#page-${savedPage}`) ||
    $(`.page-section[data-page-section="${savedPage}"]`);

  showPage(hasSavedPage ? savedPage : 'dashboard');
}

/* =====================================================
   6. DASHBOARD
===================================================== */

function updateDashboardDisplay() {
  const campaigns = campaignCache;

  const totalCampaigns = $('#totalCampaigns');
  const pendingApprovals = $('#pendingApprovals');

  if (totalCampaigns) {
    totalCampaigns.textContent =
      dashboardCache?.totalCampaigns ?? campaigns.length;
  }

  if (pendingApprovals) {
    pendingApprovals.textContent =
      dashboardCache?.pendingApprovals ??
      campaigns.filter(item => item.status === 'pending').length;
  }

  const approvedElement = $('#approvedCampaigns');

  if (approvedElement) {
    approvedElement.textContent =
      dashboardCache?.approvedCampaigns ??
      campaigns.filter(item => item.status === 'approved').length;
  }

  const activeElement = $('#activeCampaigns');

  if (activeElement) {
    activeElement.textContent =
      dashboardCache?.activeCampaigns ??
      campaigns.filter(item => item.status === 'active').length;
  }

  const budgetElement = $('#totalPlannedBudget');

  if (budgetElement) {
    const total = dashboardCache?.totalPlannedBudget ??
      campaigns.reduce((sum, item) => sum + item.budget, 0);

    budgetElement.textContent = formatMoney(total);
  }

  renderCampaigns();
  renderBudgetOverview();
}

/* =====================================================
   7. CAMPAIGN TABLE
===================================================== */

function statusLabel(status) {
  const labels = {
    draft: 'ฉบับร่าง',
    pending: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    rejected: 'ไม่อนุมัติ',
    active: 'กำลังดำเนินการ',
    completed: 'เสร็จสิ้น',
    paused: 'หยุดชั่วคราว'
  };

  return labels[status] || status || '-';
}

function renderCampaigns() {
  // ใน index.html กำหนด campaignTable ไว้ที่ <tbody> โดยตรง
  // จึงต้องเขียนข้อมูลลงใน element นี้ ไม่ต้องค้นหา <tbody> ซ้ำ
  const tbody = $('#campaignTable');

  if (!tbody) {
    console.warn('ไม่พบ #campaignTable ในหน้าเว็บ');
    return;
  }

  if (!campaignCache.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="table-empty">
          ยังไม่มีข้อมูลแคมเปญ
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = campaignCache.map(campaign => {
    const canSubmit =
      campaign.status === 'draft' ||
      campaign.status === 'rejected';

    const canDecide =
      campaign.status === 'pending';

    const actionButtons = `
      ${
        canSubmit
          ? `<button type="button" data-submit-approval="${escapeHTML(campaign.id)}">ส่งอนุมัติ</button>`
          : ''
      }
      ${
        canDecide
          ? `
            <button type="button" data-approve-campaign="${escapeHTML(campaign.id)}">อนุมัติ</button>
            <button type="button" data-reject-campaign="${escapeHTML(campaign.id)}">ปฏิเสธ</button>
          `
          : ''
      }
      <button type="button" data-delete-campaign="${escapeHTML(campaign.id)}">ลบ</button>
    `;

    return `
      <tr>
        <td>${escapeHTML(campaign.name || '-')}</td>
        <td>${escapeHTML(campaign.goal || '-')}</td>
        <td>${formatMoney(campaign.budget)}</td>
        <td>
          <span class="status-${escapeHTML(campaign.status)}">
            ${escapeHTML(statusLabel(campaign.status))}
          </span>
          <div class="campaign-actions">${actionButtons}</div>
        </td>
      </tr>
    `;
  }).join('');

  bindCampaignActions();
}

function bindCampaignActions() {
  $all('[data-delete-campaign]').forEach(button => {
    button.addEventListener('click', () => {
      deleteCampaign(button.dataset.deleteCampaign, button);
    });
  });

  $all('[data-submit-approval]').forEach(button => {
    button.addEventListener('click', () => {
      submitApproval(button.dataset.submitApproval, button);
    });
  });

  $all('[data-approve-campaign]').forEach(button => {
    button.addEventListener('click', () => {
      decideApproval(
        button.dataset.approveCampaign,
        'APPROVED',
        button
      );
    });
  });

  $all('[data-reject-campaign]').forEach(button => {
    button.addEventListener('click', () => {
      decideApproval(
        button.dataset.rejectCampaign,
        'REJECTED',
        button
      );
    });
  });
}

/* =====================================================
   8. CREATE CAMPAIGN
===================================================== */

async function createCampaignRecord(data) {
  if (apiBusy) {
    alert('ระบบกำลังดำเนินการ กรุณารอสักครู่');
    return null;
  }

  apiBusy = true;

  const existingIds = new Set(
    campaignCache.map(item => item.id)
  );

  const createdAfter = Date.now();

  try {
    await apiPost({
      action: 'createCampaign',
      data: {
        name: data.name,
        goal: data.goal,
        platform: data.platform || 'ยังไม่เลือก',
        targetArea: data.targetArea || 'แม่อ่อน เชียงใหม่',
        audience: data.audience || '',
        service: data.service || '',
        offer: data.offer || '',
        budget: Number(data.budget),
        days: Number(data.days)
      }
    });

    const verification = await verifyServerChange(campaigns => {
      return campaigns.find(item =>
        !existingIds.has(item.id) &&
        item.name === data.name &&
        item.goal === data.goal &&
        Number(item.budget) === Number(data.budget) &&
        (
          !item.createdAt ||
          new Date(item.createdAt).getTime() >= createdAfter - 30000
        )
      );
    });

    if (verification.success) {
      const campaign = verification.matched;

      await loadDashboard({ silent: true });

      alert(
        'สร้างแคมเปญและตรวจสอบข้อมูลใน Google Sheets สำเร็จแล้ว\n\n' +
        'ชื่อ: ' + campaign.name +
        '\nงบประมาณ: ' + formatMoney(campaign.budget) +
        '\nระยะเวลา: ' + (campaign.days || '-') + ' วัน' +
        '\nงบเฉลี่ยต่อวัน: ' + formatMoney(campaign.dailyBudget) +
        '\nสถานะ: ฉบับร่าง'
      );

      showPage('campaigns');

      return campaign;
    }

    alert(
      'ส่งคำสั่งสร้างแคมเปญแล้ว แต่ยังตรวจสอบข้อมูลกลับจาก Google Sheets ไม่พบ\n\n' +
      'เพื่อป้องกันการสร้างรายการซ้ำ ระบบจะไม่ส่งคำสั่งซ้ำให้อัตโนมัติ\n\n' +
      'กรุณาตรวจสอบชีต Campaigns ก่อนกดสร้างอีกครั้ง'
    );

    return null;

  } catch (error) {
    console.error('Create campaign error:', error);

    alert(
      'ไม่สามารถส่งคำสั่งสร้างแคมเปญได้\n\n' +
      error.message +
      '\n\nกรุณาตรวจสอบชีต Campaigns ก่อนลองใหม่ เพื่อป้องกันข้อมูลซ้ำ'
    );

    return null;

  } finally {
    apiBusy = false;
  }
}

function openCreateCampaign() {
  const name = prompt('ชื่อแคมเปญโฆษณา');

  if (name === null) return;

  if (!name.trim()) {
    alert('กรุณากรอกชื่อแคมเปญ');
    return;
  }

  const goal = prompt(
    'เป้าหมายแคมเปญ\n' +
    'ตัวอย่าง: เพิ่มลูกค้าใหม่ / เพิ่มยอดจอง / ดึงลูกค้าเก่ากลับมา'
  );

  if (goal === null) return;

  if (!goal.trim()) {
    alert('กรุณากรอกเป้าหมายแคมเปญ');
    return;
  }

  const platform = prompt(
    'แพลตฟอร์มโฆษณา\nตัวอย่าง: Facebook / Instagram / Google',
    'Facebook'
  );

  if (platform === null) return;

  const budgetText = prompt(
    'งบประมาณรวม (บาท)',
    '132'
  );

  if (budgetText === null) return;

  const budget = Number(budgetText);

  if (!Number.isFinite(budget) || budget <= 0) {
    alert('กรุณากรอกงบประมาณเป็นตัวเลขที่มากกว่า 0');
    return;
  }

  const daysText = prompt('ระยะเวลาโฆษณา (วัน)', '4');

  if (daysText === null) return;

  const days = Number(daysText);

  if (!Number.isInteger(days) || days <= 0) {
    alert('กรุณากรอกจำนวนวันเป็นจำนวนเต็มที่มากกว่า 0');
    return;
  }

  const targetArea = prompt(
    'พื้นที่กลุ่มเป้าหมาย',
    'แม่อ่อน เชียงใหม่'
  );

  if (targetArea === null) return;

  const audience = prompt(
    'กลุ่มลูกค้าเป้าหมาย',
    'ผู้ที่สนใจนวดเพื่อสุขภาพและสปา'
  );

  if (audience === null) return;

  const service = prompt(
    'บริการที่ต้องการโปรโมต',
    'นวดเพื่อสุขภาพ'
  );

  if (service === null) return;

  const offer = prompt(
    'รายละเอียดโปรโมชั่น (ถ้ามี)',
    ''
  );

  if (offer === null) return;

  createCampaignRecord({
    name: name.trim(),
    goal: goal.trim(),
    platform: platform.trim(),
    budget,
    days,
    targetArea: targetArea.trim(),
    audience: audience.trim(),
    service: service.trim(),
    offer: offer.trim()
  });
}

function setupCampaignButtons() {
  const newCampaignButton = $('#newCampaignButton');

  if (newCampaignButton) {
    newCampaignButton.addEventListener(
      'click',
      openCreateCampaign
    );
  }

  $all('[data-create-campaign]').forEach(button => {
    button.addEventListener('click', openCreateCampaign);
  });
}

/* =====================================================
   9. DELETE CAMPAIGN
===================================================== */

async function deleteCampaign(id, button) {
  const campaign = campaignCache.find(item => item.id === id);

  if (!campaign) {
    alert('ไม่พบแคมเปญนี้');
    return;
  }

  if (!confirm(
    'ต้องการลบแคมเปญนี้หรือไม่?\n\n' +
    campaign.name +
    '\n\nการลบจะมีผลกับข้อมูลใน Google Sheets'
  )) {
    return;
  }

  if (apiBusy) return;

  apiBusy = true;
  setButtonLoading(button, true);

  try {
    await apiPost({
      action: 'deleteCampaign',
      campaignId: id
    });

    const verification = await verifyServerChange(campaigns => {
      return !campaigns.some(item => item.id === id);
    });

    if (verification.success) {
      await loadDashboard({ silent: true });
      alert('ลบแคมเปญจาก Google Sheets สำเร็จแล้ว');
    } else {
      alert(
        'ส่งคำสั่งลบแล้ว แต่ยังตรวจสอบผลไม่สำเร็จ\n' +
        'กรุณาตรวจสอบชีต Campaigns ก่อนดำเนินการซ้ำ'
      );
    }

  } catch (error) {
    alert(
      'ส่งคำสั่งลบไม่สำเร็จ\n\n' + error.message
    );

  } finally {
    apiBusy = false;
    setButtonLoading(button, false);
  }
}

/* =====================================================
   10. APPROVAL WORKFLOW
===================================================== */

async function submitApproval(id, button) {
  const campaign = campaignCache.find(item => item.id === id);

  if (!campaign) {
    alert('ไม่พบแคมเปญ');
    return;
  }

  if (!confirm(
    'ส่งแคมเปญนี้เข้าคิวรออนุมัติหรือไม่?\n\n' +
    campaign.name
  )) {
    return;
  }

  if (apiBusy) return;

  apiBusy = true;
  setButtonLoading(button, true);

  try {
    await apiPost({
      action: 'submitApproval',
      campaignId: id
    });

    const verification = await verifyServerChange(campaigns => {
      const updated = campaigns.find(item => item.id === id);
      return updated && updated.status === 'pending';
    });

    if (verification.success) {
      await loadDashboard({ silent: true });
      alert('ส่งแคมเปญเข้าคิวรออนุมัติเรียบร้อยแล้ว');
    } else {
      alert(
        'ส่งคำสั่งแล้ว แต่ยังตรวจสอบสถานะรออนุมัติไม่พบ\n' +
        'กรุณาตรวจสอบชีต Campaigns ก่อนลองอีกครั้ง'
      );
    }

  } catch (error) {
    alert('ไม่สามารถส่งคำขออนุมัติได้\n\n' + error.message);

  } finally {
    apiBusy = false;
    setButtonLoading(button, false);
  }
}

async function decideApproval(id, decision, button) {
  const campaign = campaignCache.find(item => item.id === id);

  if (!campaign) {
    alert('ไม่พบแคมเปญ');
    return;
  }

  const isApprove = decision === 'APPROVED';

  const note = prompt(
    isApprove
      ? 'หมายเหตุการอนุมัติ (ถ้ามี)'
      : 'เหตุผลที่ปฏิเสธ (ถ้ามี)',
    ''
  );

  if (note === null) return;

  const confirmText = isApprove
    ? 'ยืนยันอนุมัติแคมเปญนี้หรือไม่?'
    : 'ยืนยันปฏิเสธแคมเปญนี้หรือไม่?';

  if (!confirm(confirmText + '\n\n' + campaign.name)) {
    return;
  }

  if (apiBusy) return;

  apiBusy = true;
  setButtonLoading(button, true);

  const expectedStatus = isApprove ? 'approved' : 'rejected';

  try {
    await apiPost({
      action: 'decideApproval',
      campaignId: id,
      decision,
      note: note.trim()
    });

    const verification = await verifyServerChange(campaigns => {
      const updated = campaigns.find(item => item.id === id);

      return updated &&
        updated.status === expectedStatus;
    });

    if (verification.success) {
      await loadDashboard({ silent: true });

      alert(
        isApprove
          ? 'บันทึกการอนุมัติเรียบร้อยแล้ว'
          : 'บันทึกการปฏิเสธเรียบร้อยแล้ว'
      );
    } else {
      alert(
        'ส่งคำสั่งแล้ว แต่ยังตรวจสอบสถานะใหม่ไม่พบ\n' +
        'กรุณาตรวจสอบชีต Campaigns และ Approvals'
      );
    }

  } catch (error) {
    alert(
      'ไม่สามารถบันทึกผลการตัดสินใจได้\n\n' +
      error.message
    );

  } finally {
    apiBusy = false;
    setButtonLoading(button, false);
  }
}

/* =====================================================
   11. AI ANALYSIS PREPARATION
===================================================== */

function setupAIAnalysis() {
  const analyzeButton = $('#analyzeButton');

  if (!analyzeButton) return;

  analyzeButton.addEventListener('click', () => {
    const name = $('#analysisName')?.value.trim() || '';
    const goal = $('#analysisGoal')?.value || '';
    const budget = Number($('#analysisBudget')?.value || 0);
    const days = Number($('#analysisDays')?.value || 0);
    const offer = $('#analysisOffer')?.value.trim() || '';

    const message = $('#analysisMessage');

    if (!name) {
      showMessage(message, 'กรุณากรอกชื่อแคมเปญ', 'error');
      return;
    }

    if (!goal) {
      showMessage(message, 'กรุณาเลือกเป้าหมายโฆษณา', 'error');
      return;
    }

    if (!Number.isFinite(budget) || budget <= 0) {
      showMessage(message, 'กรุณากรอกงบประมาณให้ถูกต้อง', 'error');
      return;
    }

    if (!Number.isInteger(days) || days <= 0) {
      showMessage(message, 'กรุณากรอกระยะเวลาเป็นจำนวนวัน', 'error');
      return;
    }

    const dailyBudget = budget / days;

    const analysisRequest = {
      campaignName: name,
      goal,
      budget,
      days,
      dailyBudget,
      offer,
      platform: 'ยังไม่ได้เลือก',
      requestedAt: new Date().toISOString()
    };

    console.log(
      'NICHA ADS PRO - AI Analysis Request:',
      analysisRequest
    );

    let recommendation = '';

    if (dailyBudget < 30) {
      recommendation =
        'งบประมาณเฉลี่ยต่อวันค่อนข้างต่ำ ควรพิจารณาเพิ่มงบหรือปรับกลุ่มเป้าหมายให้แคบลง';
    } else if (dailyBudget <= 100) {
      recommendation =
        'ควรเริ่มจากกลุ่มเป้าหมายในพื้นที่ใกล้ร้าน และใช้ภาพหรือวิดีโอที่แสดงบริการจริง';
    } else {
      recommendation =
        'มีงบประมาณสำหรับทดสอบโฆษณา ควรแบ่งทดสอบเนื้อหาโฆษณาและกลุ่มเป้าหมายอย่างเป็นระบบ';
    }

    showMessage(
      message,
      'รับข้อมูลสำหรับเตรียมวิเคราะห์แล้ว\n\n' +
      'งบประมาณรวม: ' + formatMoney(budget) +
      '\nระยะเวลา: ' + days + ' วัน' +
      '\nเฉลี่ยต่อวัน: ' + formatMoney(dailyBudget) +
      '\n\nข้อเสนอแนะเบื้องต้น:\n' + recommendation +
      '\n\nหมายเหตุ: นี่เป็นการประเมินเบื้องต้นจากเงื่อนไขงบประมาณ ยังไม่ได้เรียก AI API หรือวิเคราะห์ข้อมูลโฆษณาจริง',
      'info'
    );
  });
}

/* =====================================================
   12. BUDGET OVERVIEW
===================================================== */

function renderBudgetOverview() {
  const budgetTable = $('#budgetTable');

  if (!budgetTable) return;

  let tbody = budgetTable.querySelector('tbody');

  if (!tbody) {
    tbody = document.createElement('tbody');
    budgetTable.appendChild(tbody);
  }

  if (!campaignCache.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          ยังไม่มีข้อมูลงบประมาณ
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = campaignCache.map(item => `
    <tr>
      <td>${escapeHTML(item.name)}</td>
      <td>${escapeHTML(item.platform || '-')}</td>
      <td>${formatMoney(item.budget)}</td>
      <td>${formatMoney(item.dailyBudget)}</td>
      <td>${escapeHTML(statusLabel(item.status))}</td>
    </tr>
  `).join('');
}

/* =====================================================
   13. SETTINGS / SYSTEM INFO
===================================================== */

function setupSystemInfo() {
  const versionElement = $('#appVersion');

  if (versionElement) {
    versionElement.textContent = NICHA_ADS.version;
  }

  const dateElement = $('#currentDate');

  if (dateElement) {
    dateElement.textContent = todayText();
  }
}

/* =====================================================
   14. API HEALTH CHECK
===================================================== */

async function checkApiHealth() {
  try {
    const result = await apiGet('health');

    console.log('NICHA ADS PRO API HEALTH:', result);

    return result;

  } catch (error) {
    console.error('API health check failed:', error);

    return {
      success: false,
      message: error.message
    };
  }
}

/* =====================================================
   15. INITIALIZE APPLICATION
===================================================== */

async function initNichaAdsPro() {
  console.log(
    '%cNICHA ADS PRO',
    'font-size:20px;font-weight:bold;color:#C6A36B;'
  );

  console.log('Version:', NICHA_ADS.version);

  setupNavigation();
  setupCampaignButtons();
  setupAIAnalysis();
  setupSystemInfo();

  await checkApiHealth();

  try {
    await loadCampaigns({ silent: true });
    await loadDashboard({ silent: true });

    console.log(
      'NICHA ADS PRO initialized successfully.'
    );

  } catch (error) {
    console.error(
      'NICHA ADS PRO initialization warning:',
      error
    );

    const tbody = $('#campaignTable');

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="table-empty">
            ไม่สามารถโหลดข้อมูลจาก Google Sheets ได้
            <br>
            <small>
              กรุณาตรวจสอบการเข้าสู่ระบบ Google และสิทธิ์การใช้งาน
            </small>
          </td>
        </tr>
      `;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    initNichaAdsPro
  );
} else {
  initNichaAdsPro();
}
