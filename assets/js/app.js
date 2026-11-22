
/******************************************************
 * NICHA ADS PRO
 * Frontend Application
 * Version: 1.0.0
 *
 * ระบบในเวอร์ชันนี้:
 * 1. Dashboard และเมนูนำทาง
 * 2. Mobile Sidebar
 * 3. สร้างแคมเปญเบื้องต้น
 * 4. บันทึกข้อมูลตัวอย่างใน Local Storage
 * 5. เตรียมข้อมูลสำหรับ AI Analysis
 * 6. แสดงสถานะ Approval
 *
 * หมายเหตุ:
 * ยังไม่เชื่อม Google Sheets API
 * ยังไม่เชื่อม AI API
 * ยังไม่เชื่อม Meta Ads / Google Ads
 ******************************************************/

'use strict';

const NICHA_ADS = {
  version: '1.0.0',
  storageKey: 'NICHA_ADS_PRO_CAMPAIGNS',
  pageKey: 'NICHA_ADS_PRO_LAST_PAGE'
};

/* =========================================
   1. COMMON FUNCTIONS
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

/* =========================================
   2. LOCAL STORAGE
========================================= */

function getCampaigns() {
  try {
    const data = localStorage.getItem(NICHA_ADS.storageKey);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Cannot read campaigns:', error);
    return [];
  }
}

function saveCampaigns(campaigns) {
  try {
    localStorage.setItem(
      NICHA_ADS.storageKey,
      JSON.stringify(campaigns)
    );
    return true;
  } catch (error) {
    console.error('Cannot save campaigns:', error);
    alert('ไม่สามารถบันทึกข้อมูลในเบราว์เซอร์ได้');
    return false;
  }
}

function createCampaignRecord(data) {
  const campaign = {
    id: 'NICHA-' + Date.now(),
    name: data.name,
    goal: data.goal,
    budget: Number(data.budget || 0),
    days: Number(data.days || 0),
    offer: data.offer || '',
    status: 'draft',
    createdAt: new Date().toISOString()
  };

  const campaigns = getCampaigns();
  campaigns.unshift(campaign);

  if (saveCampaigns(campaigns)) {
    renderCampaigns();
    updateDashboard();
    return campaign;
  }

  return null;
}

/* =========================================
   3. NAVIGATION
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
    localStorage.setItem(NICHA_ADS.pageKey, pageName);
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
    savedPage = localStorage.getItem(NICHA_ADS.pageKey) || 'dashboard';
  } catch (error) {
    savedPage = 'dashboard';
  }

  const hasSavedPage = $(`.page-section#${savedPage}`) ||
    $(`.page-section#page-${savedPage}`) ||
    $(`.page-section[data-page-section="${savedPage}"]`);

  showPage(hasSavedPage ? savedPage : 'dashboard');
}

function closeMobileSidebar() {
  const sidebar = $('#sidebar');

  if (sidebar) {
    sidebar.classList.remove('open');
  }
}

/* =========================================
   4. DASHBOARD
========================================= */

function updateDashboard() {
  const campaigns = getCampaigns();

  const totalCampaigns = $('#totalCampaigns');
  const pendingApprovals = $('#pendingApprovals');

  if (totalCampaigns) {
    totalCampaigns.textContent = campaigns.length;
  }

  if (pendingApprovals) {
    pendingApprovals.textContent = campaigns.filter(
      item => item.status === 'pending'
    ).length;
  }

  renderCampaigns();
}

/* =========================================
   5. CAMPAIGN TABLE
========================================= */

function renderCampaigns() {
  const table = $('#campaignTable');

  if (!table) return;

  const campaigns = getCampaigns();

  let tbody = table.querySelector('tbody');

  if (!tbody) {
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
  }

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
    const statusText = {
      draft: 'ฉบับร่าง',
      pending: 'รออนุมัติ',
      approved: 'อนุมัติแล้ว',
      active: 'กำลังดำเนินการ',
      completed: 'เสร็จสิ้น'
    }[campaign.status] || campaign.status;

    return `
      <tr>
        <td>${escapeHTML(campaign.name)}</td>
        <td>${escapeHTML(campaign.goal)}</td>
        <td>${formatMoney(campaign.budget)}</td>
        <td>${escapeHTML(campaign.days)} วัน</td>
        <td>${escapeHTML(statusText)}</td>
        <td>
          <button
            type="button"
            class="btn-delete-campaign"
            data-delete-campaign="${escapeHTML(campaign.id)}"
          >
            ลบ
          </button>
        </td>
      </tr>
    `;
  }).join('');

  $all('[data-delete-campaign]').forEach(button => {
    button.addEventListener('click', () => {
      deleteCampaign(button.dataset.deleteCampaign);
    });
  });
}

function deleteCampaign(id) {
  if (!confirm('ต้องการลบแคมเปญนี้หรือไม่?')) return;

  const campaigns = getCampaigns().filter(
    item => item.id !== id
  );

  if (saveCampaigns(campaigns)) {
    renderCampaigns();
    updateDashboard();
  }
}

/* =========================================
   6. CREATE CAMPAIGN
========================================= */

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

  const offer = prompt(
    'รายละเอียดโปรโมชั่น (ถ้ามี)',
    ''
  );

  if (offer === null) return;

  const campaign = createCampaignRecord({
    name: name.trim(),
    goal: goal.trim(),
    budget,
    days,
    offer: offer.trim()
  });

  if (campaign) {
    alert(
      'สร้างแคมเปญเรียบร้อยแล้ว\n\n' +
      'ชื่อ: ' + campaign.name +
      '\nงบประมาณ: ' + formatMoney(campaign.budget) +
      '\nระยะเวลา: ' + campaign.days + ' วัน' +
      '\nสถานะ: ฉบับร่าง'
    );

    showPage('campaigns');
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

  const createButtons = $all('[data-create-campaign]');

  createButtons.forEach(button => {
    button.addEventListener('click', openCreateCampaign);
  });
}

/* =========================================
   7. AI ANALYSIS PREPARATION
========================================= */

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
      'รับข้อมูลเรียบร้อยแล้ว ระบบเตรียมข้อมูลสำหรับ AI วิเคราะห์ไว้แล้ว แต่ยังไม่ได้วิเคราะห์จริง เนื่องจากยังไม่ได้เชื่อมต่อ AI API',
      'info'
    );

    /*
      ขั้นตอนต่อไป:
      เชื่อมข้อมูลนี้เข้ากับ Google Apps Script API
      และส่งต่อไปยัง AI Analysis Engine
    */
  });
}

/* =========================================
   8. APPROVAL CENTER
========================================= */

function updateApprovalStatus(id, newStatus) {
  const campaigns = getCampaigns();

  const campaign = campaigns.find(
    item => item.id === id
  );

  if (!campaign) return;

  campaign.status = newStatus;

  if (saveCampaigns(campaigns)) {
    renderCampaigns();
    updateDashboard();
  }
}

/* =========================================
   9. SETTINGS / SYSTEM INFO
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
}

/* =========================================
   10. INITIALIZE APPLICATION
========================================= */

function initNichaAdsPro() {
  console.log(
    '%cNICHA ADS PRO',
    'font-size:20px;font-weight:bold;color:#C6A36B;'
  );

  console.log('Version:', NICHA_ADS.version);

  setupNavigation();
  setupCampaignButtons();
  setupAIAnalysis();
  setupSystemInfo();

  updateDashboard();

  console.log('NICHA ADS PRO initialized successfully.');
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    initNichaAdsPro
  );
} else {
  initNichaAdsPro();
}
