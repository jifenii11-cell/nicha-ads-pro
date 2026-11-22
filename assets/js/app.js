
/******************************************************
 * NICHA ADS PRO
 * Frontend Application
 * Version: 1.1.0
 *
 * เชื่อมต่อ Google Apps Script API
 * Database: NICHA ADS PRO - DATABASE
 *
 * ระบบ:
 * 1. Dashboard
 * 2. Navigation / Mobile Sidebar
 * 3. โหลดแคมเปญจาก Google Sheets
 * 4. สร้างแคมเปญลง Google Sheets
 * 5. ลบแคมเปญจาก Google Sheets
 * 6. ส่งแคมเปญเข้ารออนุมัติ
 * 7. อนุมัติ / ปฏิเสธแคมเปญ
 * 8. เตรียมข้อมูลสำหรับ AI Analysis
 *
 * หมายเหตุ:
 * - ยังไม่ได้เชื่อม AI API จริง
 * - ยังไม่ได้เชื่อม Meta Ads API
 * - ยังไม่ได้เชื่อม Google Ads API
 * - ไม่มีการยิงโฆษณาอัตโนมัติ
 ******************************************************/

'use strict';

/* =========================================
   1. SYSTEM CONFIGURATION
========================================= */

const NICHA_ADS = {
  version: '1.1.0',

  apiUrl:
    'https://script.google.com/macros/s/AKfycbzuezJjKGLvKe-5APlnuH6fl6F1HQLeN7tV5_qAvNTK1BsXOo4S_KIQPA_N8sLRR80o/exec',

  pageKey: 'NICHA_ADS_PRO_LAST_PAGE',

  requestTimeout: 30000
};

let campaignCache = [];
let dashboardCache = {};
let isLoadingCampaigns = false;

/* =========================================
   2. COMMON FUNCTIONS
========================================= */

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

function showMessage(element, message, type = 'info') {
  if (!element) return;

  element.textContent = message;
  element.className = 'message ' + type;
  element.style.display = 'block';
}

function showLoadingMessage(message) {
  const table = $('#campaignTable');
  if (!table) return;

  let tbody = table.querySelector('tbody');

  if (!tbody) {
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="empty-state">
        ${escapeHTML(message)}
      </td>
    </tr>
  `;
}

function showApiError(error) {
  console.error('NICHA ADS PRO API Error:', error);

  let message = error?.message || String(error);

  alert(
    'ไม่สามารถเชื่อมต่อระบบฐานข้อมูลได้\n\n' +
    message +
    '\n\nกรุณาตรวจสอบการเข้าสู่ระบบ Google และสิทธิ์ Web App'
  );
}

/* =========================================
   3. API - JSONP GET
========================================= */

/*
 * ใช้ JSONP สำหรับ GET requests
 * เพื่อรองรับการเรียก API จาก GitHub Pages
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

    const timeout = setTimeout(() => {
      finish();

      reject(
        new Error(
          'หมดเวลารอการตอบกลับจาก Apps Script (' +
          action +
          ')'
        )
      );
    }, NICHA_ADS.requestTimeout);

    function finish() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = function(response) {
      finish();

      if (!response || response.success !== true) {
        reject(
          new Error(
            response?.message ||
            'API ตอบกลับไม่สำเร็จ'
          )
        );
        return;
      }

      resolve(response);
    };

    script.onerror = function() {
      finish();

      reject(
        new Error(
          'ไม่สามารถโหลดข้อมูลจาก Google Apps Script ได้'
        )
      );
    };

    const url = new URL(NICHA_ADS.apiUrl);

    url.searchParams.set('action', action);
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_', Date.now());

    script.src = url.toString();

    document.head.appendChild(script);
  });
}

/* =========================================
   4. API - POST
========================================= */

/*
 * ส่งข้อมูล JSON ไปยัง doPost ของ Apps Script
 *
 * ใช้ text/plain เพื่อลดปัญหา CORS preflight
 * ทั้งนี้เบราว์เซอร์และการตั้งค่า Google อาจยัง
 * จำกัดการอ่านผลตอบกลับข้ามโดเมนได้
 */

async function apiPost(payload) {

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, NICHA_ADS.requestTimeout);

  try {

    const response = await fetch(NICHA_ADS.apiUrl, {
      method: 'POST',

      headers: {
        'Content-Type': 'text/plain;charset=UTF-8'
      },

      body: JSON.stringify(payload),

      mode: 'cors',
      credentials: 'include',
      redirect: 'follow',

      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        'HTTP Error: ' + response.status
      );
    }

    const text = await response.text();

    let result;

    try {
      result = JSON.parse(text);
    } catch (error) {
      throw new Error(
        'ไม่สามารถอ่านผลตอบกลับจาก Apps Script ได้'
      );
    }

    if (!result || result.success !== true) {
      throw new Error(
        result?.message ||
        'ไม่สามารถดำเนินการกับฐานข้อมูลได้'
      );
    }

    return result;

  } catch (error) {

    if (error.name === 'AbortError') {
      throw new Error('การเชื่อมต่อหมดเวลา');
    }

    if (
      error instanceof TypeError ||
      /Failed to fetch/i.test(error.message || '')
    ) {
      throw new Error(
        'เบราว์เซอร์ไม่อนุญาตให้อ่านผลตอบกลับจาก Apps Script ' +
        'อาจเกิดจากข้อจำกัด CORS หรือการยืนยันตัวตน Google ' +
        'ยังต้องตรวจสอบการเชื่อมต่อ POST ก่อนใช้งานจริง'
      );
    }

    throw error;

  } finally {

    clearTimeout(timeout);

  }
}

/* =========================================
   5. CAMPAIGN DATA
========================================= */

function getCampaigns() {
  return campaignCache;
}

function normalizeCampaign(campaign) {

  return {
    id: campaign.id || campaign.campaignId || '',

    name: campaign.name || '',

    goal: campaign.goal || '',

    platform: campaign.platform || '',

    targetArea: campaign.targetArea || '',

    audience: campaign.audience || '',

    service: campaign.service || '',

    offer: campaign.offer || '',

    budget: Number(campaign.budget || 0),

    dailyBudget: Number(campaign.dailyBudget || 0),

    days: Number(
      campaign.days ||
      calculateCampaignDays(campaign.startDate, campaign.endDate)
    ),

    status: String(campaign.status || 'draft').toLowerCase(),

    aiScore: campaign.aiScore ?? '',

    aiRecommendation: campaign.aiRecommendation || '',

    ownerApproval: campaign.ownerApproval || '',

    createdAt: campaign.createdAt || '',

    updatedAt: campaign.updatedAt || ''
  };
}

function calculateCampaignDays(startDate, endDate) {

  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.ceil((end - start) / 86400000)
  );
}

/* =========================================
   6. LOAD CAMPAIGNS FROM GOOGLE SHEETS
========================================= */

async function loadCampaigns() {

  if (isLoadingCampaigns) return;

  isLoadingCampaigns = true;

  showLoadingMessage('กำลังโหลดข้อมูลแคมเปญ...');

  try {

    const response = await apiGet('campaigns');

    const rows = Array.isArray(response.campaigns)
      ? response.campaigns
      : [];

    campaignCache = rows.map(normalizeCampaign);

    renderCampaigns();

    updateDashboardDisplay();

    console.log(
      'Loaded campaigns from Google Sheets:',
      campaignCache.length
    );

  } catch (error) {

    console.error('Load campaigns failed:', error);

    showLoadingMessage(
      'โหลดข้อมูลไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อ Google'
    );

    showApiError(error);

  } finally {

    isLoadingCampaigns = false;

  }
}

/* =========================================
   7. DASHBOARD
========================================= */

async function loadDashboard() {

  try {

    const response = await apiGet('dashboard');

    dashboardCache = response.dashboard || {};

    updateDashboardDisplay();

  } catch (error) {

    console.error('Dashboard API Error:', error);

  }
}

function updateDashboardDisplay() {

  const campaigns = getCampaigns();

  const totalCampaigns = $('#totalCampaigns');
  const pendingApprovals = $('#pendingApprovals');

  if (totalCampaigns) {

    const total =
      dashboardCache.totalCampaigns ??
      campaigns.length;

    totalCampaigns.textContent = total;

  }

  if (pendingApprovals) {

    const pending =
      dashboardCache.pendingApprovals ??
      campaigns.filter(item => item.status === 'pending').length;

    pendingApprovals.textContent = pending;

  }

  const approvedElement = $('#approvedCampaigns');

  if (approvedElement) {

    approvedElement.textContent =
      dashboardCache.approvedCampaigns ??
      campaigns.filter(item => item.status === 'approved').length;

  }

  const activeElement = $('#activeCampaigns');

  if (activeElement) {

    activeElement.textContent =
      dashboardCache.activeCampaigns ??
      campaigns.filter(item => item.status === 'active').length;

  }

  const budgetElement = $('#totalPlannedBudget');

  if (budgetElement) {

    budgetElement.textContent = formatMoney(
      dashboardCache.totalPlannedBudget ??
      campaigns.reduce((sum, item) => sum + item.budget, 0)
    );

  }
}

async function updateDashboard() {

  await Promise.all([
    loadCampaigns(),
    loadDashboard()
  ]);

}

/* =========================================
   8. CAMPAIGN TABLE
========================================= */

function getStatusText(status) {

  const statuses = {
    draft: 'ฉบับร่าง',
    pending: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    rejected: 'ไม่อนุมัติ',
    active: 'กำลังดำเนินการ',
    completed: 'เสร็จสิ้น'
  };

  return statuses[status] || status;
}

function renderCampaigns() {

  const table = $('#campaignTable');

  if (!table) return;

  let tbody = table.querySelector('tbody');

  if (!tbody) {

    tbody = document.createElement('tbody');

    table.appendChild(tbody);

  }

  const campaigns = getCampaigns();

  if (campaigns.length === 0) {

    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          ยังไม่มีแคมเปญ
          <br>
          <small>กดปุ่มสร้างแคมเปญเพื่อเริ่มต้น</small>
        </td>
      </tr>
    `;

    return;

  }

  tbody.innerHTML = campaigns.map(campaign => {

    let actionButtons = '';

    if (campaign.status === 'draft') {

      actionButtons += `
        <button
          type="button"
          class="btn-delete-campaign"
          data-submit-approval="${escapeHTML(campaign.id)}"
        >
          ส่งอนุมัติ
        </button>
      `;

    }

    if (campaign.status === 'pending') {

      actionButtons += `
        <button
          type="button"
          class="btn-delete-campaign"
          data-approve-campaign="${escapeHTML(campaign.id)}"
        >
          อนุมัติ
        </button>

        <button
          type="button"
          class="btn-delete-campaign"
          data-reject-campaign="${escapeHTML(campaign.id)}"
        >
          ปฏิเสธ
        </button>
      `;

    }

    if (
      campaign.status !== 'active' &&
      campaign.status !== 'completed'
    ) {

      actionButtons += `
        <button
          type="button"
          class="btn-delete-campaign"
          data-delete-campaign="${escapeHTML(campaign.id)}"
        >
          ลบ
        </button>
      `;

    }

    return `
      <tr>
        <td>${escapeHTML(campaign.name)}</td>

        <td>${escapeHTML(campaign.goal)}</td>

        <td>${formatMoney(campaign.budget)}</td>

        <td>${escapeHTML(campaign.days)} วัน</td>

        <td>${escapeHTML(getStatusText(campaign.status))}</td>

        <td>${actionButtons}</td>
      </tr>
    `;

  }).join('');

  $all('[data-delete-campaign]').forEach(button => {

    button.addEventListener('click', () => {

      deleteCampaign(button.dataset.deleteCampaign);

    });

  });

  $all('[data-submit-approval]').forEach(button => {

    button.addEventListener('click', () => {

      submitCampaignApproval(
        button.dataset.submitApproval
      );

    });

  });

  $all('[data-approve-campaign]').forEach(button => {

    button.addEventListener('click', () => {

      decideCampaignApproval(
        button.dataset.approveCampaign,
        'APPROVED'
      );

    });

  });

  $all('[data-reject-campaign]').forEach(button => {

    button.addEventListener('click', () => {

      decideCampaignApproval(
        button.dataset.rejectCampaign,
        'REJECTED'
      );

    });

  });

}

/* =========================================
   9. CREATE CAMPAIGN
========================================= */

async function createCampaignRecord(data) {

  const response = await apiPost({

    action: 'createCampaign',

    data: {

      name: data.name,

      goal: data.goal,

      platform: data.platform || 'Meta Ads',

      targetArea: data.targetArea || '',

      audience: data.audience || '',

      service: data.service || '',

      offer: data.offer || '',

      budget: Number(data.budget || 0),

      days: Number(data.days || 0)

    }

  });

  await updateDashboard();

  return response.result || null;

}

async function openCreateCampaign() {

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
    'แพลตฟอร์มโฆษณา\n' +
    'Meta Ads หรือ Google Ads',
    'Meta Ads'
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

  const daysText = prompt(
    'ระยะเวลาโฆษณา (วัน)',
    '4'
  );

  if (daysText === null) return;

  const days = Number(daysText);

  if (!Number.isInteger(days) || days <= 0) {

    alert('กรุณากรอกจำนวนวันเป็นจำนวนเต็มที่มากกว่า 0');

    return;

  }

  const targetArea = prompt(
    'พื้นที่กลุ่มเป้าหมาย',
    'แม่ออน เชียงใหม่'
  );

  if (targetArea === null) return;

  const audience = prompt(
    'กลุ่มลูกค้าเป้าหมาย',
    'ผู้ที่สนใจนวดเพื่อสุขภาพและสปา'
  );

  if (audience === null) return;

  const service = prompt(
    'บริการที่ต้องการโปรโมต',
    ''
  );

  if (service === null) return;

  const offer = prompt(
    'รายละเอียดโปรโมชั่น (ถ้ามี)',
    ''
  );

  if (offer === null) return;

  try {

    const campaign = await createCampaignRecord({

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

    alert(
      'ส่งข้อมูลสร้างแคมเปญเรียบร้อยแล้ว\n\n' +
      'ระบบบันทึกข้อมูลผ่าน API แล้ว\n' +
      'กรุณาตรวจสอบรายการแคมเปญในระบบ'
    );

    showPage('campaigns');

    await updateDashboard();

  } catch (error) {

    showApiError(error);

  }

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

    button.addEventListener(
      'click',
      openCreateCampaign
    );

  });

}

/* =========================================
   10. DELETE CAMPAIGN
========================================= */

async function deleteCampaign(id) {

  if (!confirm('ต้องการลบแคมเปญนี้หรือไม่?')) return;

  try {

    await apiPost({

      action: 'deleteCampaign',

      campaignId: id

    });

    alert('ลบแคมเปญเรียบร้อยแล้ว');

    await updateDashboard();

  } catch (error) {

    showApiError(error);

  }

}

/* =========================================
   11. APPROVAL CENTER
========================================= */

async function submitCampaignApproval(id) {

  if (
    !confirm(
      'ต้องการส่งแคมเปญนี้เข้าสู่ระบบรออนุมัติหรือไม่?'
    )
  ) {
    return;
  }

  try {

    await apiPost({

      action: 'submitApproval',

      campaignId: id

    });

    alert(
      'ส่งคำขออนุมัติเรียบร้อยแล้ว\n' +
      'แคมเปญยังไม่ถูกนำไปยิงโฆษณา'
    );

    await updateDashboard();

  } catch (error) {

    showApiError(error);

  }

}

async function decideCampaignApproval(id, decision) {

  const approved = decision === 'APPROVED';

  const message = approved
    ? 'ยืนยันอนุมัติแคมเปญนี้หรือไม่?'
    : 'ยืนยันไม่อนุมัติแคมเปญนี้หรือไม่?';

  if (!confirm(message)) return;

  let note = prompt(
    'หมายเหตุการพิจารณา (ถ้ามี)',
    ''
  );

  if (note === null) return;

  try {

    await apiPost({

      action: 'decideApproval',

      campaignId: id,

      decision,

      note: note.trim()

    });

    alert(
      approved
        ? 'อนุมัติแคมเปญเรียบร้อยแล้ว'
        : 'บันทึกผลการไม่อนุมัติเรียบร้อยแล้ว'
    );

    await updateDashboard();

  } catch (error) {

    showApiError(error);

  }

}

/*
 * คงชื่อฟังก์ชันเดิมไว้เพื่อรองรับการเรียกจากหน้าอื่น
 */

function updateApprovalStatus(id, newStatus) {

  if (newStatus === 'approved') {

    return decideCampaignApproval(id, 'APPROVED');

  }

  if (newStatus === 'rejected') {

    return decideCampaignApproval(id, 'REJECTED');

  }

  if (newStatus === 'pending') {

    return submitCampaignApproval(id);

  }

}

/* =========================================
   12. AI ANALYSIS PREPARATION
========================================= */

function setupAIAnalysis() {

  const analyzeButton = $('#analyzeButton');

  if (!analyzeButton) return;

  analyzeButton.addEventListener('click', async () => {

    const name = $('#analysisName')?.value.trim() || '';

    const goal = $('#analysisGoal')?.value || '';

    const budget = Number(
      $('#analysisBudget')?.value || 0
    );

    const days = Number(
      $('#analysisDays')?.value || 0
    );

    const offer = $('#analysisOffer')?.value.trim() || '';

    const message = $('#analysisMessage');

    if (!name) {

      showMessage(
        message,
        'กรุณากรอกชื่อแคมเปญ',
        'error'
      );

      return;

    }

    if (!goal) {

      showMessage(
        message,
        'กรุณาเลือกเป้าหมายโฆษณา',
        'error'
      );

      return;

    }

    if (!Number.isFinite(budget) || budget <= 0) {

      showMessage(
        message,
        'กรุณากรอกงบประมาณให้ถูกต้อง',
        'error'
      );

      return;

    }

    if (!Number.isInteger(days) || days <= 0) {

      showMessage(
        message,
        'กรุณากรอกระยะเวลาเป็นจำนวนวัน',
        'error'
      );

      return;

    }

    const analysisRequest = {

      campaignName: name,

      goal,

      budget,

      days,

      offer,

      platform: 'ยังไม่ได้เลือก',

      requestedAt: new Date().toISOString()

    };

    console.log(
      'NICHA ADS PRO - AI Analysis Request:',
      analysisRequest
    );

    showMessage(
      message,
      'ตรวจสอบข้อมูลเรียบร้อยแล้ว ขณะนี้ยังไม่ได้เชื่อมต่อ AI API จริง จึงยังไม่มีผลวิเคราะห์จาก AI',
      'info'
    );

  });

}

/* =========================================
   13. NAVIGATION
========================================= */

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

    localStorage.setItem(
      NICHA_ADS.pageKey,
      pageName
    );

  } catch (error) {

    console.warn('Cannot save current page.');

  }

  closeMobileSidebar();

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
      localStorage.getItem(NICHA_ADS.pageKey) ||
      'dashboard';

  } catch (error) {

    savedPage = 'dashboard';

  }

  const hasSavedPage =
    $(`.page-section#${savedPage}`) ||
    $(`.page-section#page-${savedPage}`) ||
    $(`.page-section[data-page-section="${savedPage}"]`);

  showPage(
    hasSavedPage
      ? savedPage
      : 'dashboard'
  );

}

function closeMobileSidebar() {

  const sidebar = $('#sidebar');

  if (sidebar) {

    sidebar.classList.remove('open');

  }

}

/* =========================================
   14. SETTINGS / SYSTEM INFO
========================================= */

function setupSystemInfo() {

  const versionElement = $('#appVersion');

  if (versionElement) {

    versionElement.textContent = NICHA_ADS.version;

  }

  const dateElement = $('#currentDate');

  if (dateElement) {

    dateElement.textContent = todayText();

  }

  const apiStatusElement = $('#apiStatus');

  if (apiStatusElement) {

    apiStatusElement.textContent = 'กำลังตรวจสอบ API...';

  }

}

/* =========================================
   15. API HEALTH CHECK
========================================= */

async function checkApiHealth() {

  try {

    const response = await apiGet('health');

    console.log(
      'NICHA ADS PRO API HEALTH:',
      response
    );

    const statusElement = $('#apiStatus');

    if (statusElement) {

      statusElement.textContent = 'เชื่อมต่อ API แล้ว';

    }

    return true;

  } catch (error) {

    console.error('API Health Check Failed:', error);

    const statusElement = $('#apiStatus');

    if (statusElement) {

      statusElement.textContent = 'เชื่อมต่อ API ไม่สำเร็จ';

    }

    return false;

  }

}

/* =========================================
   16. INITIALIZE APPLICATION
========================================= */

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

  await updateDashboard();

  console.log(
    'NICHA ADS PRO initialized successfully.'
  );

}

if (document.readyState === 'loading') {

  document.addEventListener(
    'DOMContentLoaded',
    initNichaAdsPro
  );

} else {

  initNichaAdsPro();

}
