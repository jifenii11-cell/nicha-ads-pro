
/*******************************************************
 * NICHA ADS PRO
 * FILE: assets/js/app.js
 * VERSION: 1.3.0
 *
 * Frontend + Google Apps Script API
 *
 * ระบบ:
 * 1. Dashboard
 * 2. Campaign Management
 * 3. Google Sheets Database
 * 4. FREE AI Analysis via ChatGPT Manual Workflow
 * 5. Save AI Analysis to Google Sheets
 * 6. Owner Approval Workflow
 * 7. Budget Overview
 * 8. Mobile Navigation
 *
 * IMPORTANT:
 * - ChatGPT analysis is a manual handoff.
 * - No OpenAI API key required.
 * - POST is dispatched only once.
 * - GET/JSONP verifies saved data.
 * - No automatic ad publishing.
 *******************************************************/

'use strict';

/* =====================================================
   1. CONFIGURATION
===================================================== */

const NICHA_ADS = {
  version: '1.3.0',

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
let aiSelectedCampaignId = '';
let aiLatestAnalysis = null;

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
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

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
 * GET ผ่าน JSONP
 *
 * รองรับพารามิเตอร์เพิ่มเติม เช่น campaignId
 */
function apiGet(action, extraParams = {}) {
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

    const params = new URLSearchParams();

    params.set('action', action);
    params.set('callback', callbackName);
    params.set('_', String(Date.now()));

    Object.entries(extraParams || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    });

    script.src = NICHA_ADS.apiUrl +
      (NICHA_ADS.apiUrl.includes('?') ? '&' : '?') +
      params.toString();

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
 * ส่ง POST เพียงครั้งเดียว
 *
 * no-cors ทำให้ไม่สามารถอ่าน response ได้
 * ต้องตรวจสอบผลด้วย GET อีกครั้ง
 *
 * ห้ามส่ง POST ซ้ำอัตโนมัติ
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
 * โหลดรายการแคมเปญจาก Google Sheets
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
    renderAIAnalysisCampaignOptions();

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
 * ตรวจสอบการเปลี่ยนแปลงจาก Google Sheets
 *
 * ฟังก์ชันนี้ไม่ส่ง POST
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
      renderAIAnalysisCampaignOptions();

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

  if (
    pageName === 'campaigns' ||
    pageName === 'approvals'
  ) {
    loadCampaigns({ silent: true }).catch(() => {});
  }

  if (
    pageName === 'dashboard' ||
    pageName === 'budget'
  ) {
    loadDashboard({ silent: true });
  }

  if (pageName === 'analysis') {
    renderAIAnalysisCampaignOptions();
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
   11. FREE AI ANALYSIS - USER INTERFACE
===================================================== */

/**
 * เพิ่มส่วน FREE AI เข้าไปในหน้า Analysis
 * โดยไม่ต้องแก้ index.html
 */
function installAIAnalysisInterface() {
  const page =
    $('.page-section[data-page-section="analysis"]') ||
    $('#page-analysis') ||
    $('#analysis-page') ||
    $('#analysis');

  if (!page) {
    console.warn('ไม่พบหน้า AI Analysis');
    return;
  }

  if ($('#nichaFreeAIWorkspace')) return;

  const oldAnalysisButton = $('#analyzeButton');

  if (oldAnalysisButton) {
    oldAnalysisButton.disabled = true;
    oldAnalysisButton.textContent = 'ใช้ระบบ FREE AI ด้านล่าง';
    oldAnalysisButton.title =
      'ระบบวิเคราะห์เดิมถูกแทนที่ด้วย FREE AI Workflow';
  }

  const workspace = document.createElement('div');

  workspace.id = 'nichaFreeAIWorkspace';

  workspace.innerHTML = `
    <style>
      #nichaFreeAIWorkspace {
        margin-top: 24px;
        color: inherit;
      }

      #nichaFreeAIWorkspace .nicha-ai-card {
        background: #fffdf8;
        border: 1px solid #e5dccb;
        border-radius: 16px;
        padding: 22px;
        margin-bottom: 18px;
        box-shadow: 0 5px 18px rgba(50, 45, 30, .05);
      }

      #nichaFreeAIWorkspace h3 {
        color: #414936;
        margin: 0 0 12px;
        font-size: 19px;
      }

      #nichaFreeAIWorkspace p {
        line-height: 1.7;
      }

      #nichaFreeAIWorkspace label {
        display: block;
        font-weight: 600;
        color: #414936;
        margin: 14px 0 7px;
      }

      #nichaFreeAIWorkspace select,
      #nichaFreeAIWorkspace textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #d8cbb6;
        border-radius: 10px;
        padding: 12px;
        background: #fff;
        color: #333;
        font: inherit;
      }

      #nichaFreeAIWorkspace textarea {
        min-height: 190px;
        resize: vertical;
      }

      #nichaFreeAIWorkspace button {
        border: 0;
        border-radius: 9px;
        padding: 11px 16px;
        margin: 8px 6px 0 0;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
      }

      #nichaFreeAIWorkspace button:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      #nichaFreeAIWorkspace .nicha-primary {
        background: #414936;
        color: #fff;
      }

      #nichaFreeAIWorkspace .nicha-gold {
        background: #c6a36b;
        color: #fff;
      }

      #nichaFreeAIWorkspace .nicha-light {
        background: #eee8dc;
        color: #414936;
      }

      #nichaFreeAIWorkspace .nicha-ai-note {
        background: #f5f0e5;
        border-left: 4px solid #c6a36b;
        padding: 12px 15px;
        border-radius: 7px;
        line-height: 1.7;
        margin: 12px 0;
      }

      #nichaFreeAIWorkspace .nicha-ai-message {
        display: none;
        padding: 12px 14px;
        border-radius: 9px;
        margin-top: 14px;
        line-height: 1.7;
        white-space: pre-wrap;
      }

      #nichaFreeAIWorkspace .nicha-ai-message.info {
        display: block;
        background: #f0f3ed;
        color: #414936;
      }

      #nichaFreeAIWorkspace .nicha-ai-message.error {
        display: block;
        background: #fff0ed;
        color: #9a3528;
      }

      #nichaFreeAIWorkspace .nicha-ai-message.success {
        display: block;
        background: #edf5ed;
        color: #315a36;
      }

      #nichaFreeAIWorkspace .nicha-ai-result {
        border-top: 1px solid #e5dccb;
        margin-top: 18px;
        padding-top: 16px;
      }

      #nichaFreeAIWorkspace .nicha-score-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 15px 0;
      }

      #nichaFreeAIWorkspace .nicha-score {
        background: #f5f0e5;
        border-radius: 10px;
        padding: 12px;
      }

      #nichaFreeAIWorkspace .nicha-score strong {
        display: block;
        color: #414936;
        font-size: 23px;
        margin-top: 5px;
      }

      #nichaFreeAIWorkspace .nicha-result-text {
        white-space: pre-wrap;
        line-height: 1.7;
        color: #444;
      }

      @media (max-width: 600px) {
        #nichaFreeAIWorkspace .nicha-ai-card {
          padding: 15px;
        }

        #nichaFreeAIWorkspace .nicha-score-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        #nichaFreeAIWorkspace button {
          width: 100%;
          margin-right: 0;
        }
      }
    </style>

    <div class="nicha-ai-card">
      <h3>NICHA FREE AI ANALYSIS</h3>

      <p>
        ระบบช่วยวิเคราะห์แคมเปญด้วย ChatGPT
        โดยไม่ต้องใช้ OpenAI API Key
      </p>

      <div class="nicha-ai-note">
        <strong>ขั้นตอนการทำงาน</strong><br>
        1. เลือกแคมเปญ<br>
        2. สร้างคำสั่งสำหรับ ChatGPT<br>
        3. เปิด ChatGPT และส่งคำสั่ง<br>
        4. นำผลลัพธ์ JSON กลับมาวาง<br>
        5. บันทึกผลลง Google Sheets<br><br>
        ระบบนี้เป็นการส่งต่อให้ ChatGPT ด้วยตนเอง
        ไม่ได้เรียก AI อัตโนมัติ และไม่มีการยิงโฆษณาจริง
      </div>

      <label for="nichaAIcampaignSelect">
        เลือกแคมเปญที่ต้องการวิเคราะห์
      </label>

      <select id="nichaAIcampaignSelect">
        <option value="">กำลังโหลดรายการแคมเปญ...</option>
      </select>

      <div id="nichaAIcampaignInfo" class="nicha-ai-note">
        กรุณาเลือกแคมเปญ
      </div>

      <button
        type="button"
        id="nichaAIGeneratePrompt"
        class="nicha-primary">
        1. สร้างคำสั่งวิเคราะห์
      </button>

      <button
        type="button"
        id="nichaAICopyPrompt"
        class="nicha-light">
        คัดลอกคำสั่ง
      </button>

      <button
        type="button"
        id="nichaAIOpenChatGPT"
        class="nicha-gold">
        2. เปิด ChatGPT
      </button>

      <label for="nichaAIPrompt">
        คำสั่งสำหรับ ChatGPT
      </label>

      <textarea
        id="nichaAIPrompt"
        placeholder="กดสร้างคำสั่งวิเคราะห์ ระบบจะเตรียมข้อมูลให้ตรงนี้"
      ></textarea>

      <div class="nicha-ai-note">
        เมื่อ ChatGPT วิเคราะห์เสร็จแล้ว
        ให้คัดลอกผลลัพธ์ JSON ทั้งหมดกลับมาวางในช่องด้านล่าง
      </div>

      <label for="nichaAIResponse">
        3. วางผลวิเคราะห์ JSON จาก ChatGPT
      </label>

      <textarea
        id="nichaAIResponse"
        placeholder='วางผลลัพธ์ JSON เช่น {"creativeScore":80,...}'
      ></textarea>

      <button
        type="button"
        id="nichaAISaveAnalysis"
        class="nicha-primary">
        4. บันทึกผลวิเคราะห์ลง Google Sheets
      </button>

      <button
        type="button"
        id="nichaAILoadLatest"
        class="nicha-light">
        โหลดผลวิเคราะห์ล่าสุด
      </button>

      <div
        id="nichaAIMessage"
        class="nicha-ai-message"
        role="status"
        aria-live="polite">
      </div>

      <div
        id="nichaAILatestResult"
        class="nicha-ai-result">
        <p>ยังไม่ได้โหลดผลวิเคราะห์</p>
      </div>
    </div>
  `;

  page.appendChild(workspace);

  bindFreeAIEvents();
  renderAIAnalysisCampaignOptions();
}

/* =====================================================
   12. FREE AI - CAMPAIGN SELECTOR
===================================================== */

function renderAIAnalysisCampaignOptions() {
  const select = $('#nichaAIcampaignSelect');

  if (!select) return;

  const previousValue =
    aiSelectedCampaignId || select.value || '';

  if (!campaignCache.length) {
    select.innerHTML = `
      <option value="">ยังไม่มีแคมเปญในระบบ</option>
    `;

    updateAISelectedCampaignInfo();
    return;
  }

  select.innerHTML = `
    <option value="">-- เลือกแคมเปญ --</option>
    ${campaignCache.map(campaign => `
      <option value="${escapeHTML(campaign.id)}">
        ${escapeHTML(campaign.name)}
        (${escapeHTML(statusLabel(campaign.status))})
      </option>
    `).join('')}
  `;

  const stillExists = campaignCache.some(
    item => item.id === previousValue
  );

  if (stillExists) {
    select.value = previousValue;
    aiSelectedCampaignId = previousValue;
  } else {
    aiSelectedCampaignId = '';
    select.value = '';
  }

  updateAISelectedCampaignInfo();
}

function getSelectedAICampaign() {
  const select = $('#nichaAIcampaignSelect');

  const id = select?.value || aiSelectedCampaignId;

  if (!id) return null;

  return campaignCache.find(item => item.id === id) || null;
}

function updateAISelectedCampaignInfo() {
  const element = $('#nichaAIcampaignInfo');

  if (!element) return;

  const campaign = getSelectedAICampaign();

  if (!campaign) {
    element.textContent =
      'กรุณาเลือกแคมเปญเพื่อดูข้อมูลและเริ่มวิเคราะห์';

    return;
  }

  element.innerHTML = `
    <strong>ข้อมูลแคมเปญ</strong><br>
    ชื่อ: ${escapeHTML(campaign.name)}<br>
    แพลตฟอร์ม: ${escapeHTML(campaign.platform || '-')}<br>
    เป้าหมาย: ${escapeHTML(campaign.goal || '-')}<br>
    พื้นที่: ${escapeHTML(campaign.targetArea || '-')}<br>
    กลุ่มลูกค้า: ${escapeHTML(campaign.audience || '-')}<br>
    บริการ: ${escapeHTML(campaign.service || '-')}<br>
    โปรโมชั่น: ${escapeHTML(campaign.offer || '-')}<br>
    งบรวม: ${formatMoney(campaign.budget)}<br>
    ระยะเวลา: ${campaign.days || '-'} วัน<br>
    เฉลี่ยต่อวัน: ${formatMoney(campaign.dailyBudget)}<br>
    สถานะ: ${escapeHTML(statusLabel(campaign.status))}
  `;
}

/* =====================================================
   13. FREE AI - PROMPT GENERATOR
===================================================== */

function buildNichaAIPrompt(campaign) {
  const campaignData = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    platform: campaign.platform,
    objective: campaign.goal,
    targetArea: campaign.targetArea,
    audience: campaign.audience,
    service: campaign.service,
    offer: campaign.offer,
    totalBudgetTHB: campaign.budget,
    durationDays: campaign.days,
    dailyBudgetTHB: campaign.dailyBudget,
    currentStatus: campaign.status
  };

  return `
คุณคือผู้เชี่ยวชาญด้านการวางแผนโฆษณาออนไลน์
และการตลาดสำหรับธุรกิจร้านนวดเพื่อสุขภาพและสปาในประเทศไทย

หน้าที่ของคุณคือวิเคราะห์แคมเปญ NICHA SPA
อย่างเป็นกลางและให้คำแนะนำที่เจ้าของร้านนำไปใช้งานได้จริง

ข้อมูลแคมเปญ:
${JSON.stringify(campaignData, null, 2)}

กรุณาวิเคราะห์หัวข้อต่อไปนี้:

1. Creative Score
ประเมินความพร้อมของเนื้อหาและแนวคิดโฆษณา

2. Offer Score
ประเมินความน่าสนใจของโปรโมชั่นและข้อเสนอ

3. Audience Score
ประเมินความเหมาะสมของกลุ่มเป้าหมาย

4. Budget Score
ประเมินความเหมาะสมของงบประมาณและระยะเวลา

5. Booking Readiness Score
ประเมินความพร้อมในการเปลี่ยนผู้สนใจให้เป็นลูกค้าจองคิว

6. Tracking Score
ประเมินความพร้อมด้านการติดตามผลและวัดผล

ให้คะแนนทุกหัวข้อเป็นตัวเลข 0-100
โดยพิจารณาจากข้อมูลที่ได้รับเท่านั้น

กรุณาให้คำแนะนำเพิ่มเติม:
- จุดแข็งของแคมเปญ
- ปัญหาหรือความเสี่ยง
- แนวทางปรับปรุง
- สถานการณ์แย่ที่สุด (Worst Case)
- สถานการณ์ปกติ (Base Case)
- สถานการณ์ดีที่สุด (Best Case)
- ตัวอย่างข้อความโฆษณา
- คำแนะนำกลุ่มเป้าหมาย
- คำแนะนำก่อนเสนอให้เจ้าของอนุมัติ

ข้อกำหนดสำคัญ:
- ห้ามแต่งข้อมูลยอดขายหรือผลลัพธ์จริง
- ห้ามรับประกันจำนวนลูกค้า ยอดจอง หรือ ROI
- ห้ามสร้างตัวเลขคาดการณ์ที่ไม่มีหลักฐานรองรับ
- หากข้อมูลไม่เพียงพอ ให้ระบุว่าไม่ทราบหรือควรเก็บข้อมูลเพิ่ม
- วิเคราะห์ตามงบประมาณและบริการที่ได้รับจริง
- อย่าอ้างว่าได้ยิงโฆษณาแล้ว
- คำแนะนำต้องไม่ถือเป็นการอนุมัติยิงโฆษณา

กรุณาตอบกลับเป็น JSON เท่านั้น
ห้ามใส่ Markdown code fence
ห้ามเขียนคำอธิบายนอก JSON

ใช้โครงสร้าง JSON นี้เท่านั้น:

{
  "creativeScore": 0,
  "offerScore": 0,
  "audienceScore": 0,
  "budgetScore": 0,
  "bookingReadinessScore": 0,
  "trackingScore": 0,
  "recommendation": "READY / NEEDS_IMPROVEMENT / NOT_READY",
  "strengths": [
    "จุดแข็งข้อ 1"
  ],
  "problems": [
    "ปัญหาข้อ 1"
  ],
  "suggestions": [
    "ข้อเสนอแนะข้อ 1"
  ],
  "worstCase": "คำอธิบายสถานการณ์แย่ที่สุด",
  "baseCase": "คำอธิบายสถานการณ์ปกติ",
  "bestCase": "คำอธิบายสถานการณ์ดีที่สุด",
  "advertisingCopy": "ตัวอย่างข้อความโฆษณา",
  "targetAudienceAdvice": "คำแนะนำกลุ่มเป้าหมาย",
  "approvalAdvice": "คำแนะนำก่อนเจ้าของร้านอนุมัติ"
}

ตอบ JSON ที่สามารถนำไปบันทึกในระบบได้ทันที
`.trim();
}

/* =====================================================
   14. FREE AI - EVENT BINDINGS
===================================================== */

function bindFreeAIEvents() {
  const select = $('#nichaAIcampaignSelect');

  if (select) {
    select.addEventListener('change', () => {
      aiSelectedCampaignId = select.value;
      aiLatestAnalysis = null;

      updateAISelectedCampaignInfo();

      const result = $('#nichaAILatestResult');

      if (result) {
        result.innerHTML =
          '<p>กดโหลดผลวิเคราะห์ล่าสุดเพื่อดูข้อมูลของแคมเปญนี้</p>';
      }
    });
  }

  const generateButton = $('#nichaAIGeneratePrompt');

  if (generateButton) {
    generateButton.addEventListener('click', () => {
      const campaign = getSelectedAICampaign();

      if (!campaign) {
        showFreeAIMessage(
          'กรุณาเลือกแคมเปญก่อนสร้างคำสั่งวิเคราะห์',
          'error'
        );
        return;
      }

      const promptText = buildNichaAIPrompt(campaign);

      const promptArea = $('#nichaAIPrompt');

      if (promptArea) {
        promptArea.value = promptText;
      }

      showFreeAIMessage(
        'สร้างคำสั่งวิเคราะห์เรียบร้อยแล้ว\n\n' +
        'ขั้นตอนต่อไปให้คัดลอกคำสั่งและนำไปส่งใน ChatGPT',
        'success'
      );
    });
  }

  const copyButton = $('#nichaAICopyPrompt');

  if (copyButton) {
    copyButton.addEventListener('click', copyNichaAIPrompt);
  }

  const openButton = $('#nichaAIOpenChatGPT');

  if (openButton) {
    openButton.addEventListener('click', () => {
      const promptText = $('#nichaAIPrompt')?.value.trim() || '';

      if (!promptText) {
        showFreeAIMessage(
          'กรุณาสร้างคำสั่งวิเคราะห์ก่อนเปิด ChatGPT',
          'error'
        );
        return;
      }

      window.open(
        'https://chatgpt.com/',
        '_blank',
        'noopener,noreferrer'
      );
    });
  }

  const saveButton = $('#nichaAISaveAnalysis');

  if (saveButton) {
    saveButton.addEventListener('click', saveManualAIAnalysis);
  }

  const loadButton = $('#nichaAILoadLatest');

  if (loadButton) {
    loadButton.addEventListener('click', loadLatestAIAnalysis);
  }
}

function showFreeAIMessage(message, type = 'info') {
  const element = $('#nichaAIMessage');

  showMessage(element, message, type);
}

/* =====================================================
   15. FREE AI - COPY PROMPT
===================================================== */

async function copyNichaAIPrompt() {
  const promptText = $('#nichaAIPrompt')?.value.trim() || '';

  if (!promptText) {
    showFreeAIMessage(
      'ยังไม่มีคำสั่งวิเคราะห์ กรุณากดสร้างคำสั่งก่อน',
      'error'
    );
    return;
  }

  try {
    await navigator.clipboard.writeText(promptText);

    showFreeAIMessage(
      'คัดลอกคำสั่งเรียบร้อยแล้ว\nนำไปวางใน ChatGPT ได้เลย',
      'success'
    );

  } catch (error) {
    const textarea = $('#nichaAIPrompt');

    if (textarea) {
      textarea.focus();
      textarea.select();

      const copied = document.execCommand('copy');

      if (copied) {
        showFreeAIMessage(
          'คัดลอกคำสั่งเรียบร้อยแล้ว',
          'success'
        );
      } else {
        showFreeAIMessage(
          'ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาเลือกข้อความและคัดลอกด้วยตนเอง',
          'error'
        );
      }
    }
  }
}

/* =====================================================
   16. FREE AI - JSON VALIDATION
===================================================== */

function parseManualAIResponse(rawText) {
  let text = String(rawText || '').trim();

  if (!text) {
    throw new Error('กรุณาวางผลวิเคราะห์จาก ChatGPT');
  }

  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error(
      'ไม่พบ JSON ที่ถูกต้อง กรุณาคัดลอกผลลัพธ์ JSON จาก ChatGPT ใหม่'
    );
  }

  text = text.slice(firstBrace, lastBrace + 1);

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      'รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจสอบข้อความจาก ChatGPT'
    );
  }

  const scoreFields = [
    'creativeScore',
    'offerScore',
    'audienceScore',
    'budgetScore',
    'bookingReadinessScore',
    'trackingScore'
  ];

  scoreFields.forEach(field => {
    const value = Number(data[field]);

    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new Error(
        'คะแนน ' + field + ' ต้องเป็นตัวเลขตั้งแต่ 0 ถึง 100'
      );
    }

    data[field] = value;
  });

  const allowedRecommendations = [
    'READY',
    'NEEDS_IMPROVEMENT',
    'NOT_READY'
  ];

  data.recommendation = String(
    data.recommendation || ''
  ).trim().toUpperCase();

  if (!allowedRecommendations.includes(data.recommendation)) {
    throw new Error(
      'ค่า recommendation ต้องเป็น READY, NEEDS_IMPROVEMENT หรือ NOT_READY'
    );
  }

  const textFields = [
    'worstCase',
    'baseCase',
    'bestCase',
    'advertisingCopy',
    'targetAudienceAdvice',
    'approvalAdvice'
  ];

  textFields.forEach(field => {
    if (typeof data[field] !== 'string') {
      throw new Error(
        'ไม่พบข้อมูล ' + field + ' ในผลวิเคราะห์'
      );
    }
  });

  const arrayFields = [
    'strengths',
    'problems',
    'suggestions'
  ];

  arrayFields.forEach(field => {
    if (!Array.isArray(data[field])) {
      throw new Error(
        'ข้อมูล ' + field + ' ต้องเป็นรายการ Array'
      );
    }

    data[field] = data[field]
      .map(item => String(item))
      .filter(item => item.trim() !== '');
  });

  return data;
}

/* =====================================================
   17. FREE AI - SAVE TO GOOGLE SHEETS
===================================================== */

async function saveManualAIAnalysis() {
  if (apiBusy) {
    showFreeAIMessage(
      'ระบบกำลังดำเนินการ กรุณารอสักครู่',
      'info'
    );
    return;
  }

  const campaign = getSelectedAICampaign();

  if (!campaign) {
    showFreeAIMessage(
      'กรุณาเลือกแคมเปญก่อนบันทึกผลวิเคราะห์',
      'error'
    );
    return;
  }

  let analysis;

  try {
    analysis = parseManualAIResponse(
      $('#nichaAIResponse')?.value || ''
    );
  } catch (error) {
    showFreeAIMessage(error.message, 'error');
    return;
  }

  const confirmed = confirm(
    'ยืนยันบันทึกผลวิเคราะห์ลง Google Sheets หรือไม่?\n\n' +
    'แคมเปญ: ' + campaign.name +
    '\nคำแนะนำ: ' + analysis.recommendation +
    '\n\nระบบจะบันทึกผลวิเคราะห์หนึ่งรายการ'
  );

  if (!confirmed) return;

  apiBusy = true;

  const button = $('#nichaAISaveAnalysis');

  setButtonLoading(button, true);

  try {
    /*
     * POST ครั้งเดียวเท่านั้น
     * ห้ามส่งซ้ำหาก GET ตรวจสอบไม่พบ
     */
    await apiPost({
      action: 'saveManualAnalysis',
      campaignId: campaign.id,
      analysis: analysis
    });

    showFreeAIMessage(
      'ส่งคำสั่งบันทึกแล้ว กำลังตรวจสอบข้อมูลใน Google Sheets...',
      'info'
    );

    let savedAnalysis = null;
    let lastError = null;

    for (
      let attempt = 1;
      attempt <= NICHA_ADS.verifyAttempts;
      attempt++
    ) {
      await sleep(NICHA_ADS.verifyDelay);

      try {
        const result = await apiGet('analysis', {
          campaignId: campaign.id
        });

        savedAnalysis = extractAnalysisResult(result);

        if (savedAnalysis) {
          break;
        }

      } catch (error) {
        lastError = error;

        console.warn(
          'AI analysis verification attempt ' + attempt,
          error.message
        );
      }
    }

    if (savedAnalysis) {
      aiLatestAnalysis = savedAnalysis;

      renderLatestAIAnalysis(savedAnalysis);

      showFreeAIMessage(
        'บันทึกผลวิเคราะห์และตรวจสอบข้อมูลจาก Google Sheets แล้ว',
        'success'
      );

      return;
    }

    showFreeAIMessage(
      'ส่งคำสั่งบันทึกแล้ว แต่ยังตรวจสอบผลจาก Google Sheets ไม่พบ\n\n' +
      'เพื่อป้องกันข้อมูลซ้ำ ระบบจะไม่ส่งคำสั่งบันทึกซ้ำอัตโนมัติ\n\n' +
      'กรุณากดโหลดผลวิเคราะห์ล่าสุด หรือตรวจสอบชีต AI Analysis ก่อนลองบันทึกใหม่' +
      (lastError ? '\n\nรายละเอียด: ' + lastError.message : ''),
      'error'
    );

  } catch (error) {
    console.error('Save manual AI analysis error:', error);

    showFreeAIMessage(
      'ไม่สามารถส่งคำสั่งบันทึกได้\n\n' + error.message +
      '\n\nกรุณาตรวจสอบชีต AI Analysis ก่อนลองอีกครั้ง',
      'error'
    );

  } finally {
    apiBusy = false;
    setButtonLoading(
      button,
      false,
      '4. บันทึกผลวิเคราะห์ลง Google Sheets'
    );
  }
}

/**
 * รองรับผลลัพธ์ API ที่คืน analysis
 * หรือคืนข้อมูลวิเคราะห์เป็น object โดยตรง
 */
function extractAnalysisResult(result) {
  if (!result) return null;

  if (
    result.analysis &&
    typeof result.analysis === 'object'
  ) {
    return result.analysis;
  }

  if (
    result.data &&
    result.data.analysis &&
    typeof result.data.analysis === 'object'
  ) {
    return result.data.analysis;
  }

  if (
    result.analysisId ||
    result.totalScore !== undefined ||
    result.creativeScore !== undefined
  ) {
    return result;
  }

  return null;
}

/* =====================================================
   18. FREE AI - LOAD LATEST ANALYSIS
===================================================== */

async function loadLatestAIAnalysis() {
  const campaign = getSelectedAICampaign();

  if (!campaign) {
    showFreeAIMessage(
      'กรุณาเลือกแคมเปญก่อนโหลดผลวิเคราะห์',
      'error'
    );
    return;
  }

  const button = $('#nichaAILoadLatest');

  setButtonLoading(button, true);

  try {
    showFreeAIMessage(
      'กำลังโหลดผลวิเคราะห์จาก Google Sheets...',
      'info'
    );

    const result = await apiGet('analysis', {
      campaignId: campaign.id
    });

    const analysis = extractAnalysisResult(result);

    if (!analysis) {
      aiLatestAnalysis = null;

      const resultBox = $('#nichaAILatestResult');

      if (resultBox) {
        resultBox.innerHTML = `
          <p>ยังไม่พบผลวิเคราะห์ที่บันทึกไว้สำหรับแคมเปญนี้</p>
        `;
      }

      showFreeAIMessage(
        'ยังไม่มีผลวิเคราะห์ที่บันทึกไว้สำหรับแคมเปญนี้',
        'info'
      );

      return;
    }

    aiLatestAnalysis = analysis;

    renderLatestAIAnalysis(analysis);

    showFreeAIMessage(
      'โหลดผลวิเคราะห์ล่าสุดเรียบร้อยแล้ว',
      'success'
    );

  } catch (error) {
    console.error('Load latest AI analysis error:', error);

    showFreeAIMessage(
      'โหลดผลวิเคราะห์ไม่สำเร็จ\n\n' + error.message,
      'error'
    );

  } finally {
    setButtonLoading(button, false, 'โหลดผลวิเคราะห์ล่าสุด');
  }
}

/* =====================================================
   19. FREE AI - DISPLAY ANALYSIS
===================================================== */

function renderLatestAIAnalysis(analysis) {
  const container = $('#nichaAILatestResult');

  if (!container) return;

  const scoreFields = [
    ['Creative', analysis.creativeScore],
    ['Offer', analysis.offerScore],
    ['Audience', analysis.audienceScore],
    ['Budget', analysis.budgetScore],
    ['Booking', analysis.bookingReadinessScore],
    ['Tracking', analysis.trackingScore]
  ];

  const totalScore = Number(
    analysis.totalScore ??
    (
      scoreFields.reduce(
        (sum, item) => sum + Number(item[1] || 0),
        0
      ) / scoreFields.length
    )
  );

  const recommendation = String(
    analysis.recommendation || ''
  ).toUpperCase();

  const recommendationLabels = {
    READY: 'มีความพร้อมเบื้องต้น',
    NEEDS_IMPROVEMENT: 'ควรปรับปรุงก่อน',
    NOT_READY: 'ยังไม่พร้อม'
  };

  const renderList = value => {
    if (!Array.isArray(value) || !value.length) {
      return '<p>- ไม่มีข้อมูล</p>';
    }

    return '<ul>' + value.map(item =>
      '<li>' + escapeHTML(item) + '</li>'
    ).join('') + '</ul>';
  };

  container.innerHTML = `
    <h3>ผลวิเคราะห์ล่าสุด</h3>

    <div class="nicha-ai-note">
      <strong>คะแนนรวม: ${escapeHTML(totalScore.toFixed(1))}/100</strong><br>
      คำแนะนำ: ${escapeHTML(
        recommendationLabels[recommendation] ||
        recommendation ||
        '-'
      )}<br>
      <small>
        คะแนนนี้เป็นการประเมินจาก ChatGPT
        ไม่ใช่ผลลัพธ์จากการยิงโฆษณาจริง
      </small>
    </div>

    <div class="nicha-score-grid">
      ${scoreFields.map(item => `
        <div class="nicha-score">
          <span>${escapeHTML(item[0])}</span>
          <strong>${escapeHTML(item[1] ?? '-')}</strong>
          <small>/ 100</small>
        </div>
      `).join('')}
    </div>

    <div class="nicha-result-text">
      <h4>จุดแข็ง</h4>
      ${renderList(analysis.strengths)}

      <h4>ปัญหาและความเสี่ยง</h4>
      ${renderList(analysis.problems)}

      <h4>ข้อเสนอแนะ</h4>
      ${renderList(analysis.suggestions)}

      <h4>Worst Case</h4>
      <p>${escapeHTML(analysis.worstCase || '-')}</p>

      <h4>Base Case</h4>
      <p>${escapeHTML(analysis.baseCase || '-')}</p>

      <h4>Best Case</h4>
      <p>${escapeHTML(analysis.bestCase || '-')}</p>

      <h4>ตัวอย่างข้อความโฆษณา</h4>
      <p>${escapeHTML(analysis.advertisingCopy || '-')}</p>

      <h4>คำแนะนำกลุ่มเป้าหมาย</h4>
      <p>${escapeHTML(analysis.targetAudienceAdvice || '-')}</p>

      <h4>คำแนะนำก่อนอนุมัติ</h4>
      <p>${escapeHTML(analysis.approvalAdvice || '-')}</p>
    </div>
  `;
}

/* =====================================================
   20. LEGACY AI BUTTON
===================================================== */

/**
 * ไม่ใช้ระบบประเมินแบบเดิมอีกต่อไป
 * ป้องกันการแสดงผลที่ทำให้เข้าใจว่าเป็น AI จริง
 */
function setupAIAnalysis() {
  installAIAnalysisInterface();
}

/* =====================================================
   21. BUDGET OVERVIEW
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
   22. SETTINGS / SYSTEM INFO
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
   23. API HEALTH CHECK
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
   24. INITIALIZE APPLICATION
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

    renderAIAnalysisCampaignOptions();

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
