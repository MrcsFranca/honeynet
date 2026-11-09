const API_URL = "/events?limit=1000";
const REFRESH_INTERVAL = 5000;

let allEvents = [];

const elements = {
    indicator: document.getElementById("api-indicator"),
    status: document.getElementById("api-status"),
    totalEvents: document.getElementById("total-events"),
    totalSensors: document.getElementById("total-sensors"),
    totalSessions: document.getElementById("total-sessions"),
    totalLogins: document.getElementById("total-logins"),
    sensorChart: document.getElementById("sensor-chart"),
    eventChart: document.getElementById("event-chart"),
    table: document.getElementById("events-table"),
    sensorFilter: document.getElementById("sensor-filter"),
    eventFilter: document.getElementById("event-filter"),
    searchFilter: document.getElementById("search-filter"),
    lastUpdate: document.getElementById("last-update"),
};

// Impede que dados recebidos dos sensores sejam interpretados como HTML.
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function countBy(events, field) {
    const counts = {};

    for (const event of events) {
        const value = event[field] || "Não identificado";
        counts[value] = (counts[value] || 0) + 1;
    }

    return counts;
}

function renderChart(container, counts, limit = Infinity) {
    const entries = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

    if (entries.length === 0) {
        container.innerHTML = "<p>Nenhum dado disponível.</p>";
        return;
    }

    const maxValue = Math.max(...entries.map(([, count]) => count));

    container.innerHTML = entries.map(([label, count]) => {
        const width = (count / maxValue) * 100;

        return `
            <div class="bar-item">
                <span class="bar-label">${escapeHTML(label)}</span>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${width}%"></div>
                </div>
                <span class="bar-value">${count}</span>
            </div>
        `;
    }).join("");
}

function renderMetrics(events) {
    const sensors = new Set(
        events.map(event => event.sensor).filter(Boolean)
    );

    const sessions = new Set(
        events.map(event => event.payload?.session).filter(Boolean)
    );

    const logins = events.filter(event =>
        event.eventid === "cowrie.login.success" ||
        event.eventid === "cowrie.login.failed"
    );

    elements.totalEvents.textContent = events.length;
    elements.totalSensors.textContent = sensors.size;
    elements.totalSessions.textContent = sessions.size;
    elements.totalLogins.textContent = logins.length;
}

function updateFilterOptions(select, values, defaultLabel) {
    const previousValue = select.value;

    const options = [...values]
        .filter(Boolean)
        .sort()
        .map(value => `
            <option value="${escapeHTML(value)}">
                ${escapeHTML(value)}
            </option>
        `).join("");

    select.innerHTML = `
        <option value="">${defaultLabel}</option>
        ${options}
    `;

    if (values.includes(previousValue)) {
        select.value = previousValue;
    }
}

function renderFilters(events) {
    const sensors = [...new Set(events.map(event => event.sensor))];
    const types = [...new Set(events.map(event => event.eventid))];

    updateFilterOptions(
        elements.sensorFilter,
        sensors,
        "Todos os sensores"
    );

    updateFilterOptions(
        elements.eventFilter,
        types,
        "Todos os eventos"
    );
}

function formatDate(timestamp) {
    if (!timestamp) return "—";

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString("pt-BR");
}

function renderTable(events) {
    const sensor = elements.sensorFilter.value;
    const eventType = elements.eventFilter.value;
    const search = elements.searchFilter.value.toLowerCase();

    const filtered = events.filter(event => {
        const matchesSensor = !sensor || event.sensor === sensor;
        const matchesType = !eventType || event.eventid === eventType;

        const searchable = JSON.stringify(event).toLowerCase();
        const matchesSearch = !search || searchable.includes(search);

        return matchesSensor && matchesType && matchesSearch;
    });

    if (filtered.length === 0) {
        elements.table.innerHTML = `
            <tr>
                <td colspan="5">Nenhum evento encontrado.</td>
            </tr>
        `;
        return;
    }

    elements.table.innerHTML = filtered.map(event => {
        const payload = event.payload || {};
        const details = payload.input || payload.message || "—";

        return `
            <tr>
                <td>${escapeHTML(formatDate(event.timestamp))}</td>
                <td>${escapeHTML(event.sensor || "—")}</td>
                <td>
                    <span class="event-type">
                        ${escapeHTML(event.eventid || "—")}
                    </span>
                </td>
                <td>${escapeHTML(payload.src_ip || "—")}</td>
                <td>${escapeHTML(details)}</td>
            </tr>
        `;
    }).join("");
}

function renderDashboard() {
    renderMetrics(allEvents);

    renderChart(
        elements.sensorChart,
        countBy(allEvents, "sensor")
    );

    renderChart(
        elements.eventChart,
        countBy(allEvents, "eventid"),
        8
    );

    renderFilters(allEvents);
    renderTable(allEvents);
}

async function loadEvents() {
    try {
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const events = await response.json();

        if (!Array.isArray(events)) {
            throw new Error("Resposta inválida da API");
        }

        allEvents = events;

        elements.indicator.className = "indicator online";
        elements.status.textContent = "Collector conectado";

        renderDashboard();

        elements.lastUpdate.textContent =
            `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;

    } catch (error) {
        console.error("Erro ao carregar eventos:", error);

        elements.indicator.className = "indicator offline";
        elements.status.textContent = "Collector indisponível";
        elements.lastUpdate.textContent = "Falha na atualização";
    }
}

elements.sensorFilter.addEventListener("change", () => {
    renderTable(allEvents);
});

elements.eventFilter.addEventListener("change", () => {
    renderTable(allEvents);
});

elements.searchFilter.addEventListener("input", () => {
    renderTable(allEvents);
});

loadEvents();
setInterval(loadEvents, REFRESH_INTERVAL);
