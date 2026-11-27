import http from 'node:http';
import { openDb } from './db.js';
import { HttpError } from './errors.js';
import * as store from './store.js';
import {
  dashboardPage,
  employeeFormPage,
  employeePage,
  employeesPage,
  errorPage,
  payrollPage,
  runPage,
} from './views.js';

export const db = openDb(process.env.HRIS_DB || 'data/hris.db');

const currentPeriod = () => new Date().toISOString().slice(0, 7);

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      throw new HttpError(400, 'body is not valid JSON');
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, status, markup) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(markup),
  });
  res.end(markup);
}

function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

const flashFor = (params) => {
  if (params.get('completed')) return 'Payroll completed. Payslips are issued and the run is locked.';
  if (params.get('created')) return 'Employee created. Save a salary contract to make them payable.';
  if (params.get('saved') === 'contract') return 'Contract saved.';
  if (params.get('saved') === 'attendance') return 'Attendance saved.';
  if (params.get('created_run')) return 'Payroll run created as a draft. Review it, then complete it.';
  return '';
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const params = url.searchParams;
  const isApi = path === '/health' || path.startsWith('/api/');
  const html = (status, markup) => sendHtml(res, status, markup);

  const fail = (error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (isApi) return sendJson(res, status, { error: error.message });
    return html(status, errorPage(status, error.message));
  };

  try {
    /* ------------------------------------------------------------- health */
    if (method === 'GET' && path === '/health') {
      return sendJson(res, 200, { ok: true, service: 'yuki-hris-demo' });
    }

    /* --------------------------------------------------------- api: people */
    if (method === 'GET' && path === '/api/employees') {
      return sendJson(res, 200, { employees: store.listEmployees(db) });
    }

    if (method === 'POST' && path === '/api/employees') {
      const detail = store.createEmployee(db, await readBody(req));
      return sendJson(res, 201, { employee: detail.employee, contract: detail.contract });
    }

    let match = path.match(/^\/api\/employees\/(\d+)$/);
    if (method === 'GET' && match) {
      const detail = store.employeeDetail(db, Number(match[1]));
      if (!detail) throw new HttpError(404, 'employee not found');
      return sendJson(res, 200, detail);
    }

    match = path.match(/^\/api\/employees\/(\d+)\/contracts?$/);
    if (method === 'POST' && match) {
      const contract = store.addContract(db, Number(match[1]), await readBody(req));
      return sendJson(res, 201, { contract });
    }

    match = path.match(/^\/api\/employees\/(\d+)\/attendance$/);
    if ((method === 'PUT' || method === 'POST') && match) {
      const attendance = store.recordAttendance(db, Number(match[1]), await readBody(req));
      return sendJson(res, 200, { attendance });
    }

    /* -------------------------------------------------------- api: payroll */
    if (method === 'GET' && path === '/api/payroll/runs') {
      return sendJson(res, 200, { runs: store.listRuns(db) });
    }

    if (method === 'POST' && path === '/api/payroll/runs') {
      const detail = store.createRun(db, await readBody(req));
      return sendJson(res, 201, detail);
    }

    match = path.match(/^\/api\/payroll\/runs\/(\d+)$/);
    if (method === 'GET' && match) {
      const detail = store.runDetail(db, Number(match[1]));
      if (!detail) throw new HttpError(404, 'payroll run not found');
      return sendJson(res, 200, detail);
    }

    match = path.match(/^\/api\/payroll\/runs\/(\d+)\/complete$/);
    if (method === 'POST' && match) {
      const detail = store.completeRun(db, Number(match[1]));
      return sendJson(res, 200, detail);
    }

    /* ------------------------------------------------------------ api: 404 */
    if (isApi) throw new HttpError(404, 'route not found');

    /* ------------------------------------------------------------- pages */
    if (method === 'GET' && path === '/') {
      return html(
        200,
        dashboardPage({ stats: store.stats(db), employees: store.listEmployees(db) }),
      );
    }

    if (method === 'GET' && path === '/employees') {
      return html(200, employeesPage({ employees: store.listEmployees(db), flash: flashFor(params) }));
    }

    if (method === 'GET' && path === '/employees/new') {
      return html(200, employeeFormPage());
    }

    if (method === 'POST' && path === '/employees') {
      let body;
      try {
        body = await readBody(req);
        const detail = store.createEmployee(db, body);
        return redirect(res, `/employees/${detail.employee.id}?created=1`);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return html(error.status, employeeFormPage({ error: error.message }));
      }
    }

    match = path.match(/^\/employees\/(\d+)$/);
    if (method === 'GET' && match) {
      const detail = store.employeeDetail(db, Number(match[1]));
      if (!detail) throw new HttpError(404, 'employee not found');
      return html(
        200,
        employeePage({
          detail,
          flash: flashFor(params),
          error: params.get('error') || '',
          defaultPeriod: currentPeriod(),
        }),
      );
    }

    match = path.match(/^\/employees\/(\d+)\/contract$/);
    if (method === 'POST' && match) {
      const id = Number(match[1]);
      try {
        store.addContract(db, id, await readBody(req));
        return redirect(res, `/employees/${id}?saved=contract`);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return redirect(res, `/employees/${id}?error=${encodeURIComponent(error.message)}`);
      }
    }

    match = path.match(/^\/employees\/(\d+)\/attendance$/);
    if (method === 'POST' && match) {
      const id = Number(match[1]);
      try {
        store.recordAttendance(db, id, await readBody(req));
        return redirect(res, `/employees/${id}?saved=attendance`);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return redirect(res, `/employees/${id}?error=${encodeURIComponent(error.message)}`);
      }
    }

    if (method === 'GET' && path === '/payroll') {
      const stats = store.stats(db);
      return html(
        200,
        payrollPage({
          runs: store.listRuns(db),
          employeesReady: stats.employees > 0,
          flash: flashFor(params),
          error: params.get('error') || '',
          defaultPeriod: currentPeriod(),
        }),
      );
    }

    if (method === 'POST' && path === '/payroll/runs') {
      try {
        const detail = store.createRun(db, await readBody(req));
        return redirect(res, `/payroll/${detail.run.id}?created_run=1`);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return redirect(res, `/payroll?error=${encodeURIComponent(error.message)}`);
      }
    }

    match = path.match(/^\/payroll\/(\d+)$/);
    if (method === 'GET' && match) {
      const detail = store.runDetail(db, Number(match[1]));
      if (!detail) throw new HttpError(404, 'payroll run not found');
      return html(
        200,
        runPage({ detail, flash: flashFor(params), error: params.get('error') || '' }),
      );
    }

    match = path.match(/^\/payroll\/runs\/(\d+)\/complete$/);
    if (method === 'POST' && match) {
      const id = Number(match[1]);
      try {
        store.completeRun(db, id);
        return redirect(res, `/payroll/${id}?completed=1`);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return redirect(res, `/payroll/${id}?error=${encodeURIComponent(error.message)}`);
      }
    }

    throw new HttpError(404, 'page not found');
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(error);
    return fail(error);
  }
}

export const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.end();
  });
});

if (process.env.HRIS_NO_LISTEN !== '1') {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`Yuki Tera Workforce demo running at http://${host}:${port}`);
    console.log(`Database: ${process.env.HRIS_DB || 'data/hris.db'}`);
  });
}
