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
      linguagemMaisUsada,
      segundaLinguagemMaisUsada
    } = await getAllStats(octokit, USERNAME);

    // 3. Montar as linhas do "painel ASCII"
    const dataAgora = new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC';
    
    // Largura fixa para todas as linhas
    const LARGURA_LINHA = 39; // Largura total incluindo os pipes
    
    // Função auxiliar para formatar linha com conteúdo
    function formatarLinha(texto, valor = "") {
      // Calcula o espaço disponível após considerar o texto, os pipes e o valor
      const espacoDisponivel = LARGURA_LINHA - texto.length - valor.length - 4; // -4 para "│ " no início e " │" no final
      
      // Cria a linha formatada com o espaço correto
      return `│ ${texto}${" ".repeat(espacoDisponivel)}${valor} │`;
    }
    
    const asciiLines = [
      "┌─────────────────────────────────────┐", // 39 caracteres
      "│              Statistics             │", // 39 caracteres
      "├─────────────────────────────────────┤", // 39 caracteres
      formatarLinha("Commits (últimos 7 dias):", totalCommits7d.toString()),
      formatarLinha("PRs criadas (últimos 7 dias):", totalPRs7d.toString()),
      formatarLinha("Issues abertas (últimos 7 dias):", totalIssues7d.toString()),
      "├─────────────────────────────────────┤", // 39 caracteres
      formatarLinha("Linguagem + usada:", linguagemMaisUsada),
      formatarLinha("2ª linguagem + usada:", segundaLinguagemMaisUsada),
      formatarLinha("Repositório + ativo:", repoMaisAtivo),
      "└─────────────────────────────────────┘", // 39 caracteres
      ` Last update: ${dataAgora} `
    ];

    // 4. Gerar GIF animado digitando linha a linha
    await generateGif(asciiLines);

    console.log("GIF gerado e salvo como retro-stats.gif");
    
    // 5. Gerar ou atualizar README.md
    await generateReadme({
      totalCommits7d,
      repoMaisAtivo,
      totalPRs7d,
      totalIssues7d,
      linguagemMaisUsada,
      segundaLinguagemMaisUsada,
      dataAgora
    });
    
    console.log("README.md gerado com sucesso!");
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
      const langRes = await octokit.repos.listLanguages({
        owner: username,
        repo: name
      });
      const langs = langRes.data; // Ex.: { "JavaScript": 12345, "HTML": 200, ... }
      
      // Log para debug
      console.log(`Linguagens em ${name}:`, Object.keys(langs).length ? Object.keys(langs) : "Nenhuma");
      
      for (const [lang, count] of Object.entries(langs)) {
        if (!languageTotals[lang]) {
          languageTotals[lang] = 0;
        }
        languageTotals[lang] += count;
      }
    } catch (err) {
      // Se der erro, mostrar o erro completo para debugging
      console.error(`Erro ao pegar linguagens de ${name}:`, err.message);
    }
  }

  // Verificar se temos dados de linguagens
  console.log("Linguagens encontradas:", Object.keys(languageTotals));
  console.log("Totais por linguagem:", languageTotals);

  // 3) Descobrir linguagem mais usada (com verificação extra)
  let linguagemMaisUsada = 'N/A';
  let segundaLinguagemMaisUsada = 'N/A';
  let maxLangValue = -1; // Inicializar com -1 para garantir que qualquer valor maior será considerado
  let secondMaxLangValue = -1;
  
  // Verificar se temos dados de linguagens antes de processá-los
  if (Object.keys(languageTotals).length > 0) {
    for (const [lang, total] of Object.entries(languageTotals)) {
      if (total > maxLangValue) {
        segundaLinguagemMaisUsada = linguagemMaisUsada;
        secondMaxLangValue = maxLangValue;
        maxLangValue = total;
        linguagemMaisUsada = lang;
      } else if (total > secondMaxLangValue) {
        secondMaxLangValue = total;
        segundaLinguagemMaisUsada = lang;
      }
    }
  } else {
    console.warn("Nenhuma informação de linguagem encontrada!");
  }

  // 4) Contar PRs e issues criadas nos últimos 7 dias
  const totalPRs7d = await countPRsLast7Days(octokit, username, sevenDaysAgo);
  const totalIssues7d = await countIssuesLast7Days(octokit, username, sevenDaysAgo);

  return {
    totalCommits7d,
    repoMaisAtivo,
    totalPRs7d,
    totalIssues7d,
    linguagemMaisUsada,
    segundaLinguagemMaisUsada
  };
}

/**
 * Lista todos os repositórios públicos do usuário, paginando se precisar.
 * Se quiser private repos, precisa de token com escopo extra + setar `visibility: "all"`.
 */
async function listAllUserRepos(octokit, username) {
  let page = 1;
  const allRepos = [];
  
  console.log(`Buscando repositórios para o usuário: ${username}`);
  
  while (true) {
    try {
      const { data } = await octokit.repos.listForUser({
        username,
        per_page: REPOS_PER_PAGE,
        page,
        // Tente incluir repositórios privados se possível
        type: "all"
      });
      
      console.log(`Página ${page}: Encontrados ${data.length} repositórios`);
      
      if (data.length === 0) {
        console.warn("Nenhum repositório encontrado! Verifique o nome de usuário.");
        break;
      }
      
      allRepos.push(...data);
      
      if (data.length < REPOS_PER_PAGE) {
        break; // não há mais páginas
      }
      page++;
    } catch (error) {
      console.error("Erro ao listar repositórios:", error.message);
      break;
    }
  }
  
  console.log(`Total de repositórios encontrados: ${allRepos.length}`);
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
  const WIDTH = 1200;
  const HEIGHT = 250;
  const DELAY = 100;   // ms por frame
  const END_DELAY = 2000; // delay maior no final da animação (em ms)

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

  // Adiciona uma pausa maior no final da animação antes de recomeçar
  const framesNoFinal = Math.ceil(END_DELAY / DELAY);
  encoder.setDelay(DELAY); // Mantém o mesmo delay para consistência
  for (let i = 0; i < framesNoFinal; i++) {
    drawFrame(ctx, typedLines, WIDTH, HEIGHT);
    encoder.addFrame(ctx);
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

  // Centralizando o texto horizontalmente
  // Assumindo que as linhas têm aproximadamente a mesma largura
  // Estimando a largura do texto com base no número de caracteres
  const lineWidth = ctx.measureText(lines[0]).width || 560; // Largura estimada da linha mais longa
  const startX = (width - lineWidth) / 2;
  
  let y = 40;
  for (const line of lines) {
    ctx.fillText(line, startX, y);
    y += 20;
  }
}

/**
 * Gera um arquivo README.md com as estatísticas e o GIF
 */
async function generateReadme(stats) {
  const {
    totalCommits7d,
    repoMaisAtivo,
    totalPRs7d,
    totalIssues7d,
    linguagemMaisUsada,
    segundaLinguagemMaisUsada,
    dataAgora
  } = stats;
  
  const readmePath = path.join(__dirname, '..', 'README.md');
  
  // Conteúdo do README
  const content = `# Estatísticas GitHub

![Estatísticas em GIF](retro-stats.gif)

## Dados dos últimos 7 dias
- **Commits:** ${totalCommits7d}
- **PRs criadas:** ${totalPRs7d}
- **Issues abertas:** ${totalIssues7d}
- **Linguagem mais usada:** ${linguagemMaisUsada}
- **Segunda linguagem mais usada:** ${segundaLinguagemMaisUsada}
- **Repositório mais ativo:** ${repoMaisAtivo}

Atualizado em: ${dataAgora}

---
`;

  // Salvar o arquivo
  try {
    fs.writeFileSync(readmePath, content, 'utf8');
  } catch (error) {
    console.error('Erro ao gerar README.md:', error);
    throw error;
  }
}
