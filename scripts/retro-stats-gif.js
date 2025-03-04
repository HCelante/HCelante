#!/usr/bin/env node

/**
 * Exemplo de script Node.js que:
 * 1) Conta commits, PRs, e issues reais dos últimos 7 dias (API REST do GitHub).
 * 2) Descobre a linguagem mais usada e o repo mais ativo em commits.
 * 3) Gera um GIF animado estilo "terminal" digitando essas estatísticas.
 *
 * Depende de:
 *   - @octokit/rest
 *   - gifencoder
 *   - canvas
 * Instale via: npm install @octokit/rest gifencoder canvas
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const GIFEncoder = require('gifencoder');
const { Octokit } = require('@octokit/rest');

// Configure aqui o seu usuário e quantos repositórios queremos pegar por página
const USERNAME = 'hcelante'; // Troque pelo seu usuário real
const REPOS_PER_PAGE = 50;      // Aumente ou diminua se necessário

/**
 * Função principal: obtém dados + gera GIF
 */
(async function main() {
  try {
    // 1. Autentica via token do GitHub
    //    No GitHub Actions, você pode usar process.env.GITHUB_TOKEN
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });

    // 2. Obter estatísticas reais
    const {
      totalCommits7d,
      repoMaisAtivo,
      totalPRs7d,
      totalIssues7d,
      linguagemMaisUsada
    } = await getAllStats(octokit, USERNAME);

    // 3. Montar as linhas do "painel ASCII"
    const dataAgora = new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC';
    const asciiLines = [
      "┌─────────────────────────────────────┐",
      "│       Back-end Dev Statistics      │",
      "├─────────────────────────────────────┤",
      `│ Commits (últimos 7 dias):   ${totalCommits7d.toString().padEnd(3," ")}   │`,
      `│ PRs criadas (últimos 7 dias): ${totalPRs7d.toString().padEnd(3," ")}   │`,
      `│ Issues abertas (últimos 7 dias):${totalIssues7d.toString().padEnd(3," ")}│`,
      "├─────────────────────────────────────┤",
      `│ Linguagem + usada: ${linguagemMaisUsada.padEnd(14," ")}        │`,
      `│ Repositório + ativo: ${repoMaisAtivo.padEnd(14," ")}           │`,
      "└─────────────────────────────────────┘",
      ` Last update: ${dataAgora} `
    ];

    // 4. Gerar GIF animado digitando linha a linha
    await generateGif(asciiLines);

    console.log("GIF gerado e salvo como retro-stats.gif");
  } catch (error) {
    console.error("Erro ao gerar estatísticas e GIF:", error);
    process.exit(1);
  }
})();

/**
 * Busca dados de commits, PRs, issues e linguagens
 */
async function getAllStats(octokit, username) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sinceISO = sevenDaysAgo.toISOString(); // ex: "2025-02-26T12:34:56Z"
  const sinceDate = sinceISO; // Usado no listCommits

  // 1) Listar todos os repositórios do usuário (paginando, se necessário)
  const allRepos = await listAllUserRepos(octokit, username);

  let totalCommits7d = 0;
  let repoMaisAtivo = 'N/A';
  let maxCommitsNoRepo = 0;

  // Para descobrir linguagens mais usadas
  const languageTotals = {};

  // 2) Para cada repositório, somar commits dos últimos 7 dias e somar linguagens
  for (const repo of allRepos) {
    const { name } = repo;

    // a) Contar commits dos últimos 7 dias nesse repositório
    const commitsCount = await countCommitsLast7Days(octokit, username, name, sinceDate);
    totalCommits7d += commitsCount;

    if (commitsCount > maxCommitsNoRepo) {
      maxCommitsNoRepo = commitsCount;
      repoMaisAtivo = name;
    }

    // b) Somar linguagens
    //    (Cada linguagem retorna { languageName: linesOfCode })
    //    Precisamos de permissões para ver repositórios privados, se existirem.
    try {
      const langRes = await octokit.repos.getLanguages({
        owner: username,
        repo: name
      });
      const langs = langRes.data; // Ex.: { "JavaScript": 12345, "HTML": 200, ... }
      for (const [lang, count] of Object.entries(langs)) {
        if (!languageTotals[lang]) {
          languageTotals[lang] = 0;
        }
        languageTotals[lang] += count;
      }
    } catch (err) {
      // Se der erro, ignora esse repositório (pode ser fork, etc.)
      // console.log(`Erro ao pegar linguagens de ${name}`, err);
    }
  }

  // 3) Descobrir linguagem mais usada
  let linguagemMaisUsada = 'N/A';
  let maxLangValue = 0;
  for (const [lang, total] of Object.entries(languageTotals)) {
    if (total > maxLangValue) {
      maxLangValue = total;
      linguagemMaisUsada = lang;
    }
  }

  // 4) Contar PRs e issues criadas nos últimos 7 dias
  const totalPRs7d = await countPRsLast7Days(octokit, username, sevenDaysAgo);
  const totalIssues7d = await countIssuesLast7Days(octokit, username, sevenDaysAgo);

  return {
    totalCommits7d,
    repoMaisAtivo,
    totalPRs7d,
    totalIssues7d,
    linguagemMaisUsada
  };
}

/**
 * Lista todos os repositórios públicos do usuário, paginando se precisar.
 * Se quiser private repos, precisa de token com escopo extra + setar `visibility: "all"`.
 */
async function listAllUserRepos(octokit, username) {
  let page = 1;
  const allRepos = [];
  while (true) {
    const { data } = await octokit.repos.listForUser({
      username,
      per_page: REPOS_PER_PAGE,
      page
    });
    allRepos.push(...data);
    if (data.length < REPOS_PER_PAGE) {
      break; // não há mais páginas
    }
    page++;
  }
  return allRepos;
}

/**
 * Conta commits nos últimos 7 dias em 1 repositório usando listCommits.
 * Obs.: se o repo tiver MUITOS commits, pode precisar de paginação adicional.
 * Aqui, para simplificar, pegamos até 100 commits. Ajuste conforme necessidade.
 */
async function countCommitsLast7Days(octokit, owner, repo, sinceDate) {
  let page = 1;
  const perPage = 100;
  let total = 0;
  while (true) {
    const res = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: perPage,
      page,
      since: sinceDate
    });
    total += res.data.length;
    if (res.data.length < perPage) {
      break;
    }
    page++;
  }
  return total;
}

/**
 * Conta PRs criadas nos últimos 7 dias usando a busca.
 * Pagina até esgotar (ou até o limite).
 */
async function countPRsLast7Days(octokit, username, sevenDaysAgo) {
  const isoDateStr = sevenDaysAgo.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  const query = `type:pr author:${username} created:>${isoDateStr}`;

  return await countSearchItems(octokit, query);
}

/**
 * Conta Issues criadas nos últimos 7 dias usando a busca.
 */
async function countIssuesLast7Days(octokit, username, sevenDaysAgo) {
  const isoDateStr = sevenDaysAgo.toISOString().split('T')[0];
  const query = `type:issue author:${username} created:>${isoDateStr}`;

  return await countSearchItems(octokit, query);
}

/**
 * Faz a busca repetidamente para contar quantos itens (PRs ou issues) existem.
 * Paginação no search.issuesAndPullRequests.
 */
async function countSearchItems(octokit, query) {
  let page = 1;
  let total = 0;
  const perPage = 100;

  while (true) {
    const res = await octokit.search.issuesAndPullRequests({
      q: query,
      per_page: perPage,
      page
    });
    total += res.data.items.length;

    // Se veio menos que perPage, acabou
    if (res.data.items.length < perPage) {
      break;
    }
    page++;
    // (Opcional: adicionar um limite de segurança para não ficar
    //  looping em caso de algum erro ou se tiver MUITAS issues.)
  }
  return total;
}

/**
 * Gera o GIF animado, simulando "digitação" do array asciiLines.
 */
async function generateGif(asciiLines) {
  const WIDTH = 600;
  const HEIGHT = 250;
  const DELAY = 100;   // ms por frame

  const encoder = new GIFEncoder(WIDTH, HEIGHT);
  const outputFile = path.join(__dirname, '..', 'retro-stats.gif');
  const writeStream = fs.createWriteStream(outputFile);

  encoder.createReadStream().pipe(writeStream);
  encoder.start();
  encoder.setRepeat(0);   // 0 = loop infinito
  encoder.setDelay(DELAY);
  encoder.setQuality(10);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.font = '16px monospace';

  // Simular digitação
  const typedLines = asciiLines.map(() => ''); // array de strings vazias, mesmo tamanho
  for (let i = 0; i < asciiLines.length; i++) {
    const fullLine = asciiLines[i];
    for (let j = 0; j < fullLine.length; j++) {
      typedLines[i] += fullLine[j];
      drawFrame(ctx, typedLines, WIDTH, HEIGHT);
      encoder.addFrame(ctx);
    }
    // Pausa entre linhas
    for (let x = 0; x < 3; x++) {
      drawFrame(ctx, typedLines, WIDTH, HEIGHT);
      encoder.addFrame(ctx);
    }
  }

  encoder.finish();
}

/**
 * Desenha 1 quadro do GIF (fundo preto + texto verde).
 */
function drawFrame(ctx, lines, width, height) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#00ff00';
  ctx.font = '16px monospace';

  let y = 40;
  for (const line of lines) {
    ctx.fillText(line, 20, y);
    y += 20;
  }
}
