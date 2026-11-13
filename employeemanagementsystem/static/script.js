(function () {
  "use strict";

  const viewMode = document.body.dataset.view;
  let adminEmployeesCache = [];
  let deleteTargetId = null;

  // ---------------- Utilities ----------------
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(amount) {
    const num = Number(amount || 0);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(num);
  }

  function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3400);
  }

  async function apiFetch(url, options = {}) {
    const config = {
      headers: { "Content-Type": "application/json" },
      ...options,
    };
    const res = await fetch(url, config);
    const data = await res.json().catch(() => ({ ok: false, error: "Invalid server response." }));
    if (res.status === 401 && viewMode !== "login") {
      window.location.href = "/";
      return null;
    }
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  function statusBadge(isActive) {
    return isActive
      ? '<span class="badge badge-active">Active</span>'
      : '<span class="badge badge-inactive">Inactive</span>';
  }

  function attendanceBadge(status) {
    const map = {
      Present: "badge-present",
      Absent: "badge-absent",
      Late: "badge-late",
      "Half Day": "badge-half",
      "On Leave": "badge-leave",
    };
    const cls = map[status] || "badge-muted";
    return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
  }

  // ---------------- Global Password Toggles ----------------
  document.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest(".toggle-password");
    if (!toggleBtn) return;
    const wrapper = toggleBtn.closest(".password-field");
    const input = wrapper ? wrapper.querySelector("input") : null;
    if (!input) return;
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    toggleBtn.textContent = isHidden ? "Hide" : "Show";
    toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  });

  // ---------------- Global Logout ----------------
  document.querySelectorAll(".logout-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const result = await apiFetch("/api/logout", { method: "POST" });
      if (result && result.data && result.data.redirect_url) {
        window.location.href = result.data.redirect_url;
      } else {
        window.location.href = "/logout";
      }
    });
  });

  // ---------------- Sidebar Navigation & Mobile Drawer ----------------
  function setupShellNavigation(sectionMeta) {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const menuToggle = document.getElementById("menu-toggle");
    const pageTitle = document.getElementById("page-title");
    const pageSubtitle = document.getElementById("page-subtitle");

    function closeDrawer() {
      if (sidebar) sidebar.classList.remove("open");
      if (backdrop) backdrop.classList.remove("open");
    }

    if (menuToggle) {
      menuToggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        backdrop.classList.toggle("open");
      });
    }
    if (backdrop) {
      backdrop.addEventListener("click", closeDrawer);
    }

    function activateSection(sectionKey) {
      document.querySelectorAll(".nav-link").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.section === sectionKey);
      });
      document.querySelectorAll(".content-section").forEach((sec) => {
        sec.classList.toggle("active", sec.id === `section-${sectionKey}`);
      });
      if (sectionMeta[sectionKey]) {
        if (pageTitle) pageTitle.textContent = sectionMeta[sectionKey].title;
        if (pageSubtitle) pageSubtitle.textContent = sectionMeta[sectionKey].subtitle;
      }
      closeDrawer();
    }

    document.querySelectorAll(".nav-link").forEach((btn) => {
      btn.addEventListener("click", () => activateSection(btn.dataset.section));
    });

    document.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => activateSection(btn.dataset.jump));
    });
  }

  // ---------------- Modal Helpers ----------------
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  }

  document.addEventListener("click", (e) => {
    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
    }
    if (e.target.classList.contains("modal")) {
      e.target.classList.add("hidden");
    }
  });

  // ---------------- Login View ----------------
  if (viewMode === "login") {
    // Quick login helper buttons
    document.querySelectorAll(".quick-fill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const portal = btn.dataset.portal;
        const form = document.querySelector(`.login-form[data-portal="${portal}"]`);
        if (!form) return;
        const idInput = form.querySelector('input[name="identifier"]');
        const pwdInput = form.querySelector('input[name="password"]');
        if (idInput && pwdInput) {
          idInput.value = btn.dataset.id;
          pwdInput.value = btn.dataset.pwd;
          idInput.focus();
        }
      });
    });

    document.querySelectorAll(".login-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const portal = form.dataset.portal;
        const identifier = form.querySelector('input[name="identifier"]').value.trim();
        const password = form.querySelector('input[name="password"]').value;
        const alertBox = form.querySelector(".form-alert");

        alertBox.classList.add("hidden");
        alertBox.textContent = "";

        if (!identifier || !password) {
          alertBox.textContent = "Please enter your identifier and password.";
          alertBox.classList.remove("hidden");
          return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Signing in...";

        const result = await apiFetch("/api/login", {
          method: "POST",
          body: JSON.stringify({ portal, identifier, password }),
        });

        submitBtn.disabled = false;
        submitBtn.textContent = originalText;

        if (!result || !result.ok) {
          alertBox.textContent = (result && result.data && result.data.error) || "Login failed.";
          alertBox.classList.remove("hidden");
          return;
        }

        window.location.href = result.data.redirect_url;
      });
    });
  }

  // ---------------- Admin View ----------------
  if (viewMode === "admin") {
    setupShellNavigation({
      overview: {
        title: "Admin Dashboard",
        subtitle: "Organization overview and workforce insights",
      },
      employees: {
        title: "Employees",
        subtitle: "Add, search, update, and manage employee records",
      },
      accounts: {
        title: "Manage Accounts",
        subtitle: "Control portal access and reset employee passwords",
      },
      attendance: {
        title: "Attendance Details",
        subtitle: "Review and record daily employee attendance",
      },
    });

    async function loadAdminOverview() {
      const res = await apiFetch("/api/admin/overview");
      if (!res || !res.ok) return;
      const { stats, departments, recent_employees } = res.data;

      document.getElementById("stat-total-employees").textContent = stats.total_employees;
      document.getElementById("stat-active-accounts").textContent = stats.active_accounts;
      document.getElementById("stat-inactive-sub").textContent = `${stats.inactive_accounts} inactive`;
      document.getElementById("stat-departments").textContent = stats.departments_count;
      document.getElementById("stat-present-today").textContent = stats.present_today;

      const recentBody = document.getElementById("recent-employees-body");
      if (!recent_employees.length) {
        recentBody.innerHTML = '<tr><td colspan="5" class="empty-cell">No employees added yet.</td></tr>';
      } else {
        recentBody.innerHTML = recent_employees
          .map(
            (emp) => `
            <tr>
              <td><strong>${escapeHtml(emp.employee_id)}</strong></td>
              <td>${escapeHtml(emp.full_name)}</td>
              <td>${escapeHtml(emp.department)}</td>
              <td>${escapeHtml(emp.joining_date)}</td>
              <td>${statusBadge(emp.is_active)}</td>
            </tr>`
          )
          .join("");
      }

      const deptList = document.getElementById("department-list");
      if (!departments.length) {
        deptList.innerHTML = '<p class="empty-cell">No departments found.</p>';
      } else {
        const total = Math.max(stats.total_employees, 1);
        deptList.innerHTML = departments
          .map((d) => {
            const pct = Math.round((d.count / total) * 100);
            return `
              <div class="dept-item">
                <div class="dept-row">
                  <span>${escapeHtml(d.department)}</span>
                  <span>${d.count} (${pct}%)</span>
                </div>
                <div class="dept-bar-bg">
                  <div class="dept-bar-fill" style="width: ${pct}%"></div>
                </div>
              </div>`;
          })
          .join("");
      }
    }

    function renderEmployeesTable(employees) {
      const tbody = document.getElementById("employees-table-body");
      if (!employees.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No matching employees found.</td></tr>';
        return;
      }
      tbody.innerHTML = employees
        .map(
          (emp) => `
          <tr>
            <td><strong>${escapeHtml(emp.employee_id)}</strong></td>
            <td>
              <div><strong>${escapeHtml(emp.full_name)}</strong></div>
              <div class="muted-text">${escapeHtml(emp.email)}</div>
            </td>
            <td>${escapeHtml(emp.department)}</td>
            <td>${escapeHtml(emp.designation)}</td>
            <td>${formatCurrency(emp.salary)}</td>
            <td>${escapeHtml(emp.joining_date)}</td>
            <td>${statusBadge(emp.is_active)}</td>
            <td>
              <div class="action-group">
                <button class="btn btn-outline btn-sm btn-edit-emp" data-id="${emp.id}">Edit</button>
                <button class="btn btn-danger btn-sm btn-delete-emp" data-id="${emp.id}" data-name="${escapeHtml(emp.full_name)}">Delete</button>
              </div>
            </td>
          </tr>`
        )
        .join("");
    }

    function renderAccountsTable(employees) {
      const tbody = document.getElementById("accounts-table-body");
      const query = (document.getElementById("account-search").value || "").trim().toLowerCase();
      const filtered = query
        ? employees.filter(
            (e) =>
              e.full_name.toLowerCase().includes(query) ||
              e.username.toLowerCase().includes(query) ||
              e.email.toLowerCase().includes(query) ||
              e.employee_id.toLowerCase().includes(query)
          )
        : employees;

      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No matching accounts found.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered
        .map(
          (emp) => `
          <tr>
            <td><strong>${escapeHtml(emp.employee_id)}</strong></td>
            <td>${escapeHtml(emp.full_name)}</td>
            <td><code>${escapeHtml(emp.username)}</code></td>
            <td>${escapeHtml(emp.email)}</td>
            <td>${statusBadge(emp.is_active)}</td>
            <td>
              <div class="action-group">
                <button
                  class="btn btn-outline btn-sm btn-toggle-account"
                  data-id="${emp.id}"
                  data-next="${emp.is_active ? 0 : 1}"
                >
                  ${emp.is_active ? "Deactivate" : "Activate"}
                </button>
                <button
                  class="btn btn-primary btn-sm btn-reset-pwd"
                  data-id="${emp.id}"
                  data-name="${escapeHtml(emp.full_name)}"
                >
                  Reset Password
                </button>
              </div>
            </td>
          </tr>`
        )
        .join("");
    }

    async function loadEmployees(search = "") {
      const url = search
        ? `/api/admin/employees?q=${encodeURIComponent(search)}`
        : "/api/admin/employees";
      const res = await apiFetch(url);
      if (!res || !res.ok) return;
      if (!search) {
        adminEmployeesCache = res.data.employees;
        renderAccountsTable(adminEmployeesCache);
        populateAttendanceEmployeeSelect(adminEmployeesCache);
      }
      renderEmployeesTable(res.data.employees);
    }

    function populateAttendanceEmployeeSelect(employees) {
      const select = document.getElementById("att-employee");
      if (!select) return;
      select.innerHTML = employees
        .map(
          (emp) =>
            `<option value="${emp.id}">${escapeHtml(emp.employee_id)} — ${escapeHtml(emp.full_name)}</option>`
        )
        .join("");
    }

    async function loadAdminAttendance() {
      const q = (document.getElementById("attendance-search").value || "").trim();
      const dateVal = document.getElementById("attendance-date-filter").value || "";
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (dateVal) params.set("date", dateVal);

      const res = await apiFetch(`/api/admin/attendance?${params.toString()}`);
      if (!res || !res.ok) return;
      const tbody = document.getElementById("admin-attendance-body");
      const records = res.data.records;

      if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No attendance records found.</td></tr>';
        return;
      }

      tbody.innerHTML = records
        .map(
          (r) => `
          <tr>
            <td>${escapeHtml(r.date)}</td>
            <td><strong>${escapeHtml(r.employee_id)}</strong></td>
            <td>${escapeHtml(r.full_name)}</td>
            <td>${escapeHtml(r.department)}</td>
            <td>${attendanceBadge(r.status)}</td>
            <td>${escapeHtml(r.check_in || "—")}</td>
            <td>${escapeHtml(r.check_out || "—")}</td>
            <td>${escapeHtml(r.notes || "—")}</td>
          </tr>`
        )
        .join("");
    }

    // Current date in topbar
    const dateOpts = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
    const todayFormatted = new Date().toLocaleDateString("en-US", dateOpts);
    const dateChip = document.getElementById("topbar-current-date");
    if (dateChip) dateChip.textContent = todayFormatted;

    // Real-time username suggestion from full name
    const fullNameInput = document.getElementById("emp-full-name");
    const usernameInput = document.getElementById("emp-username");
    let usernameManuallyEdited = false;
    if (usernameInput) {
      usernameInput.addEventListener("input", () => {
        usernameManuallyEdited = true;
      });
    }
    if (fullNameInput && usernameInput) {
      fullNameInput.addEventListener("input", () => {
        const editId = document.getElementById("emp-edit-id").value;
        if (!editId && !usernameManuallyEdited) {
          const suggested = fullNameInput.value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, ".");
          usernameInput.value = suggested;
        }
      });
    }

    async function openAddEmployeeModal() {
      document.getElementById("employee-modal-title").textContent = "Add New Employee";
      document.getElementById("employee-modal-subtitle").textContent = "Create a new employee profile and credentials";
      document.getElementById("emp-submit-btn").textContent = "Create Employee";
      document.getElementById("emp-edit-id").value = "";
      document.getElementById("employee-form").reset();
      usernameManuallyEdited = false;

      const modalAlert = document.getElementById("emp-modal-alert");
      if (modalAlert) {
        modalAlert.classList.add("hidden");
        modalAlert.textContent = "";
      }

      const tag = document.getElementById("emp-modal-id-tag");
      const note = document.getElementById("emp-modal-id-note");
      if (tag) tag.textContent = "Loading...";
      if (note) note.textContent = "(Auto-generated upon saving)";

      const pwdInput = document.getElementById("emp-password");
      pwdInput.type = "password";
      pwdInput.value = "";
      pwdInput.required = true;
      pwdInput.placeholder = "Min 6 characters";
      document.getElementById("emp-password-label").textContent = "Account Password *";
      const pwdToggle = pwdInput.closest(".password-field")?.querySelector(".toggle-password");
      if (pwdToggle) pwdToggle.textContent = "Show";

      const todayLocal = new Date().toLocaleDateString("en-CA");
      document.getElementById("emp-joining-date").value = todayLocal;
      document.getElementById("emp-status").value = "1";

      openModal("employee-modal");

      const res = await apiFetch("/api/admin/next-employee-id");
      if (res && res.ok && res.data && res.data.next_employee_id) {
        if (tag) tag.textContent = res.data.next_employee_id;
      } else {
        if (tag) tag.textContent = "Auto-assigned";
      }
    }

    function openEditEmployeeModal(emp) {
      document.getElementById("employee-modal-title").textContent = `Edit Employee (${emp.employee_id})`;
      document.getElementById("employee-modal-subtitle").textContent = `Update information for ${emp.full_name}`;
      document.getElementById("emp-submit-btn").textContent = "Save Changes";
      document.getElementById("emp-edit-id").value = emp.id;
      usernameManuallyEdited = true;

      const modalAlert = document.getElementById("emp-modal-alert");
      if (modalAlert) {
        modalAlert.classList.add("hidden");
        modalAlert.textContent = "";
      }

      const tag = document.getElementById("emp-modal-id-tag");
      const note = document.getElementById("emp-modal-id-note");
      if (tag) tag.textContent = emp.employee_id;
      if (note) note.textContent = "(Permanent identifier)";

      document.getElementById("emp-full-name").value = emp.full_name;
      document.getElementById("emp-username").value = emp.username;
      document.getElementById("emp-email").value = emp.email;

      const pwdInput = document.getElementById("emp-password");
      pwdInput.type = "password";
      pwdInput.value = "";
      pwdInput.required = false;
      pwdInput.placeholder = "Leave blank to keep current password";
      document.getElementById("emp-password-label").textContent = "Reset Password (Optional)";
      const pwdToggle = pwdInput.closest(".password-field")?.querySelector(".toggle-password");
      if (pwdToggle) pwdToggle.textContent = "Show";

      document.getElementById("emp-department").value = emp.department;
      document.getElementById("emp-designation").value = emp.designation;
      document.getElementById("emp-salary").value = emp.salary;
      document.getElementById("emp-joining-date").value = emp.joining_date;
      document.getElementById("emp-phone").value = emp.phone || "";
      document.getElementById("emp-address").value = emp.address || "";
      document.getElementById("emp-status").value = emp.is_active ? "1" : "0";
      openModal("employee-modal");
    }

    document.getElementById("btn-open-add-employee").addEventListener("click", openAddEmployeeModal);
    document.getElementById("btn-add-emp-table").addEventListener("click", openAddEmployeeModal);

    document.getElementById("employee-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const editId = document.getElementById("emp-edit-id").value;
      const submitBtn = document.getElementById("emp-submit-btn");
      const modalAlert = document.getElementById("emp-modal-alert");
      if (modalAlert) {
        modalAlert.classList.add("hidden");
        modalAlert.textContent = "";
      }

      const payload = {
        full_name: document.getElementById("emp-full-name").value.trim(),
        username: document.getElementById("emp-username").value.trim(),
        email: document.getElementById("emp-email").value.trim(),
        password: document.getElementById("emp-password").value,
        department: document.getElementById("emp-department").value.trim(),
        designation: document.getElementById("emp-designation").value.trim(),
        salary: document.getElementById("emp-salary").value,
        joining_date: document.getElementById("emp-joining-date").value,
        phone: document.getElementById("emp-phone").value.trim(),
        address: document.getElementById("emp-address").value.trim(),
        is_active: document.getElementById("emp-status").value === "1",
      };

      if (!editId && (!payload.password || payload.password.length < 6)) {
        if (modalAlert) {
          modalAlert.textContent = "Password must be at least 6 characters long.";
          modalAlert.classList.remove("hidden");
        }
        showToast("Password must be at least 6 characters long.", "error");
        return;
      }

      const origBtnText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = editId ? "Saving..." : "Creating...";

      const url = editId ? `/api/admin/employees/${editId}` : "/api/admin/employees";
      const method = editId ? "PUT" : "POST";

      const res = await apiFetch(url, { method, body: JSON.stringify(payload) });

      submitBtn.disabled = false;
      submitBtn.textContent = origBtnText;

      if (!res || !res.ok) {
        const errorMsg = (res && res.data && res.data.error) || "Unable to save employee.";
        if (modalAlert) {
          modalAlert.textContent = errorMsg;
          modalAlert.classList.remove("hidden");
        }
        showToast(errorMsg, "error");
        return;
      }

      closeModal("employee-modal");
      showToast(res.data.message || (editId ? "Employee updated successfully." : "Employee created successfully."));

      await Promise.all([
        loadAdminOverview(),
        loadEmployees(""),
        loadAdminAttendance(),
      ]);

      const searchVal = document.getElementById("employee-search").value.trim();
      if (searchVal) {
        await loadEmployees(searchVal);
      }
    });

    // Employee table actions (Edit / Delete)
    document.getElementById("employees-table-body").addEventListener("click", (e) => {
      const editBtn = e.target.closest(".btn-edit-emp");
      if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const emp = adminEmployeesCache.find((item) => item.id === id);
        if (emp) openEditEmployeeModal(emp);
        return;
      }

      const delBtn = e.target.closest(".btn-delete-emp");
      if (delBtn) {
        deleteTargetId = Number(delBtn.dataset.id);
        document.getElementById("delete-confirm-text").textContent =
          `Are you sure you want to permanently delete ${delBtn.dataset.name} and their login account?`;
        openModal("delete-modal");
      }
    });

    document.getElementById("confirm-delete-btn").addEventListener("click", async () => {
      if (!deleteTargetId) return;
      const res = await apiFetch(`/api/admin/employees/${deleteTargetId}`, { method: "DELETE" });
      if (!res || !res.ok) {
        showToast((res && res.data && res.data.error) || "Delete failed.", "error");
        return;
      }
      closeModal("delete-modal");
      deleteTargetId = null;
      showToast(res.data.message || "Employee deleted.");
      await Promise.all([loadAdminOverview(), loadEmployees(""), loadAdminAttendance()]);
    });

    // Manage Accounts actions
    document.getElementById("accounts-table-body").addEventListener("click", async (e) => {
      const toggleBtn = e.target.closest(".btn-toggle-account");
      if (toggleBtn) {
        const empId = Number(toggleBtn.dataset.id);
        const nextState = toggleBtn.dataset.next === "1";
        const res = await apiFetch(`/api/admin/employees/${empId}/account`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: nextState }),
        });
        if (!res || !res.ok) {
          showToast((res && res.data && res.data.error) || "Update failed.", "error");
          return;
        }
        showToast(res.data.message || "Account updated.");
        await Promise.all([loadAdminOverview(), loadEmployees("")]);
        return;
      }

      const resetBtn = e.target.closest(".btn-reset-pwd");
      if (resetBtn) {
        document.getElementById("reset-emp-id").value = resetBtn.dataset.id;
        document.getElementById("reset-emp-label").textContent = `Setting a new password for ${resetBtn.dataset.name}`;
        document.getElementById("reset-new-password").value = "";
        openModal("reset-pwd-modal");
      }
    });

    document.getElementById("reset-pwd-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const empId = document.getElementById("reset-emp-id").value;
      const newPassword = document.getElementById("reset-new-password").value;
      const res = await apiFetch(`/api/admin/employees/${empId}/account`, {
        method: "PATCH",
        body: JSON.stringify({ new_password: newPassword }),
      });
      if (!res || !res.ok) {
        showToast((res && res.data && res.data.error) || "Password reset failed.", "error");
        return;
      }
      closeModal("reset-pwd-modal");
      showToast(res.data.message || "Password updated.");
    });

    // Search & Filters
    let searchTimer = null;
    document.getElementById("employee-search").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        loadEmployees(e.target.value.trim());
      }, 200);
    });

    document.getElementById("account-search").addEventListener("input", () => {
      renderAccountsTable(adminEmployeesCache);
    });

    document.getElementById("attendance-search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadAdminAttendance, 200);
    });

    document.getElementById("attendance-date-filter").addEventListener("change", loadAdminAttendance);
    document.getElementById("btn-clear-att-filter").addEventListener("click", () => {
      document.getElementById("attendance-search").value = "";
      document.getElementById("attendance-date-filter").value = "";
      loadAdminAttendance();
    });

    // Record Attendance Modal
    document.getElementById("btn-open-attendance").addEventListener("click", () => {
      if (!adminEmployeesCache.length) {
        showToast("Please add an employee before recording attendance.", "error");
        return;
      }
      document.getElementById("attendance-form").reset();
      document.getElementById("att-date").value = new Date().toISOString().slice(0, 10);
      openModal("attendance-modal");
    });

    document.getElementById("attendance-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        employee_ref_id: Number(document.getElementById("att-employee").value),
        date: document.getElementById("att-date").value,
        status: document.getElementById("att-status").value,
        check_in: document.getElementById("att-check-in").value,
        check_out: document.getElementById("att-check-out").value,
        notes: document.getElementById("att-notes").value.trim(),
      };
      const res = await apiFetch("/api/admin/attendance", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res || !res.ok) {
        showToast((res && res.data && res.data.error) || "Unable to save attendance.", "error");
        return;
      }
      closeModal("attendance-modal");
      showToast(res.data.message || "Attendance saved.");
      await Promise.all([loadAdminOverview(), loadAdminAttendance()]);
    });

    // Initial Admin Load
    Promise.all([loadAdminOverview(), loadEmployees(""), loadAdminAttendance()]);
  }

  // ---------------- Employee View ----------------
  if (viewMode === "employee") {
    const dateOpts = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
    const todayFormatted = new Date().toLocaleDateString("en-US", dateOpts);
    const empDateChip = document.getElementById("emp-topbar-current-date");
    if (empDateChip) empDateChip.textContent = todayFormatted;

    setupShellNavigation({
      "emp-overview": {
        title: "Employee Dashboard",
        subtitle: "Your employment overview and personal records",
      },
      "emp-profile": {
        title: "Personal Profile",
        subtitle: "View employment details and update basic contact info",
      },
      "emp-attendance": {
        title: "Attendance Details",
        subtitle: "Your attendance summary and daily logs",
      },
      "emp-security": {
        title: "Change Password",
        subtitle: "Keep your employee portal account secure",
      },
    });

    async function loadEmployeeDashboard() {
      const res = await apiFetch("/api/employee/dashboard");
      if (!res || !res.ok) return;
      const { profile, attendance_summary, attendance } = res.data;

      // Sidebar & Topbar
      document.getElementById("emp-sidebar-name").textContent = profile.full_name;
      document.getElementById("emp-sidebar-id").textContent = profile.employee_id;
      document.getElementById("emp-sidebar-avatar").textContent = profile.full_name.charAt(0).toUpperCase();
      document.getElementById("topbar-emp-id").textContent = profile.employee_id;

      // Welcome Banner & Stat Cards
      document.getElementById("emp-welcome-name").textContent = `Welcome, ${profile.full_name}`;
      document.getElementById("emp-welcome-role").textContent = `${profile.designation} • ${profile.department}`;
      document.getElementById("banner-emp-id").textContent = profile.employee_id;

      document.getElementById("card-department").textContent = profile.department;
      document.getElementById("card-designation").textContent = profile.designation;
      document.getElementById("card-salary").textContent = formatCurrency(profile.salary);
      document.getElementById("card-monthly-salary").textContent = `${formatCurrency(profile.salary / 12)} / month`;
      document.getElementById("card-joining-date").textContent = profile.joining_date;
      document.getElementById("card-present-days").textContent = attendance_summary.present;
      document.getElementById("card-total-att").textContent = `${attendance_summary.total} total logs`;

      // Profile Snapshot
      document.getElementById("snap-name").textContent = profile.full_name;
      document.getElementById("snap-username").textContent = profile.username;
      document.getElementById("snap-email").textContent = profile.email;
      document.getElementById("snap-phone").textContent = profile.phone || "Not set";
      document.getElementById("snap-address").textContent = profile.address || "Not set";

      // Read-only Employment Details & Editable Form
      document.getElementById("prof-emp-id").textContent = profile.employee_id;
      document.getElementById("prof-department").textContent = profile.department;
      document.getElementById("prof-designation").textContent = profile.designation;
      document.getElementById("prof-salary").textContent = `${formatCurrency(profile.salary)} / year`;
      document.getElementById("prof-joining-date").textContent = profile.joining_date;
      document.getElementById("prof-username").textContent = profile.username;

      document.getElementById("prof-input-name").value = profile.full_name;
      document.getElementById("prof-input-email").value = profile.email;
      document.getElementById("prof-input-phone").value = profile.phone || "";
      document.getElementById("prof-input-address").value = profile.address || "";

      // Attendance Summary & Tables
      document.getElementById("att-sum-present").textContent = attendance_summary.present;
      document.getElementById("att-sum-late").textContent = attendance_summary.late;
      document.getElementById("att-sum-leave").textContent = attendance_summary.leave;
      document.getElementById("att-sum-absent").textContent = attendance_summary.absent;

      const recentBody = document.getElementById("emp-recent-att-body");
      const fullBody = document.getElementById("emp-attendance-body");

      if (!attendance.length) {
        recentBody.innerHTML = '<tr><td colspan="4" class="empty-cell">No attendance records yet.</td></tr>';
        fullBody.innerHTML = '<tr><td colspan="5" class="empty-cell">No attendance records yet.</td></tr>';
      } else {
        recentBody.innerHTML = attendance
          .slice(0, 5)
          .map(
            (r) => `
            <tr>
              <td>${escapeHtml(r.date)}</td>
              <td>${attendanceBadge(r.status)}</td>
              <td>${escapeHtml(r.check_in || "—")}</td>
              <td>${escapeHtml(r.check_out || "—")}</td>
            </tr>`
          )
          .join("");

        fullBody.innerHTML = attendance
          .map(
            (r) => `
            <tr>
              <td>${escapeHtml(r.date)}</td>
              <td>${attendanceBadge(r.status)}</td>
              <td>${escapeHtml(r.check_in || "—")}</td>
              <td>${escapeHtml(r.check_out || "—")}</td>
              <td>${escapeHtml(r.notes || "—")}</td>
            </tr>`
          )
          .join("");
      }
    }

    document.getElementById("emp-profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        full_name: document.getElementById("prof-input-name").value.trim(),
        email: document.getElementById("prof-input-email").value.trim(),
        phone: document.getElementById("prof-input-phone").value.trim(),
        address: document.getElementById("prof-input-address").value.trim(),
      };
      const res = await apiFetch("/api/employee/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (!res || !res.ok) {
        showToast((res && res.data && res.data.error) || "Update failed.", "error");
        return;
      }
      showToast(res.data.message || "Profile updated.");
      await loadEmployeeDashboard();
    });

    document.getElementById("emp-password-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        current_password: document.getElementById("cur-password").value,
        new_password: document.getElementById("new-password").value,
        confirm_password: document.getElementById("confirm-password").value,
      };
      const res = await apiFetch("/api/employee/change-password", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res || !res.ok) {
        showToast((res && res.data && res.data.error) || "Password change failed.", "error");
        return;
      }
      e.target.reset();
      showToast(res.data.message || "Password changed successfully.");
    });

    loadEmployeeDashboard();
  }
})();

