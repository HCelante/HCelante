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
      segundaLinguagemMaisUsada,
      terceiraLinguagemMaisUsada,
      quartaLinguagemMaisUsada,
      
      // Estatísticas gerais
      totalRepos,
      reposPublicos,
      reposPrivados,
      totalStars,
      totalForks,
      userCreatedAt
    } = await getAllStats(octokit, USERNAME);

    // 3. Montar as linhas do "painel ASCII"
    const dataAgora = new Date().toISOString().replace('T', ' ').split('.')[0] + ' UTC';
    
    // Largura fixa para todas as linhas
    const LARGURA_LINHA = 80; // Largura total incluindo os pipes
    
    // Função auxiliar para formatar linha com conteúdo
    function formatarLinha(texto, valor = "") {
      // Calcula o espaço disponível após considerar o texto, os pipes e o valor
      const espacoDisponivel = LARGURA_LINHA - texto.length - valor.length - 4; // -4 para "│ " no início e " │" no final
      
      // Cria a linha formatada com o espaço correto
      return `│ ${texto}${" ".repeat(espacoDisponivel)}${valor} │`;
    }
    
    // Função para criar linhas de título e separadores com tamanho exato
    function criarLinhaTitulo(texto) {
      const espacos = LARGURA_LINHA - texto.length - 4; // -4 para "│ " e " │"
      const espacosEsquerda = Math.floor(espacos / 2);
      const espacosDireita = espacos - espacosEsquerda;
      return `│ ${" ".repeat(espacosEsquerda)}${texto}${" ".repeat(espacosDireita)} │`;
    }
    
    const linhaSuperior = "┌" + "─".repeat(LARGURA_LINHA - 2) + "┐";
    const linhaSeparadora = "├" + "─".repeat(LARGURA_LINHA - 2) + "┤";
    const linhaInferior = "└" + "─".repeat(LARGURA_LINHA - 2) + "┘";
    
    const asciiLines = [
      linhaSuperior,
      criarLinhaTitulo("Estatísticas dos últimos 7 dias"),
      linhaSeparadora,
      formatarLinha("Commits:", totalCommits7d.toString()),
      formatarLinha("PRs criadas:", totalPRs7d.toString()),
      formatarLinha("Issues abertas:", totalIssues7d.toString()),
      formatarLinha("Repositório + ativo:", repoMaisAtivo),
      linhaSeparadora,
      criarLinhaTitulo("Estatísticas Gerais"),
      linhaSeparadora,
      formatarLinha("Total de repositórios:", totalRepos.toString()),
      formatarLinha("Repositórios públicos:", reposPublicos.toString()),
      formatarLinha("Repositórios privados:", reposPrivados.toString()),
      formatarLinha("Total de stars:", totalStars.toString()),
      formatarLinha("Total de forks:", totalForks.toString()),
      formatarLinha("Conta criada em:", userCreatedAt),
      linhaSeparadora,
      criarLinhaTitulo("Linguagens Mais Usadas"),
      linhaSeparadora,
      formatarLinha("Linguagem + usada:", linguagemMaisUsada),
      formatarLinha("2ª linguagem + usada:", segundaLinguagemMaisUsada),
      formatarLinha("3ª linguagem + usada:", terceiraLinguagemMaisUsada),
      formatarLinha("4ª linguagem + usada:", quartaLinguagemMaisUsada),
      linhaInferior,
      ` Last update: ${dataAgora} `
    ];

    // Verificar o tamanho de cada linha (para diagnóstico)
    console.log("Verificando largura das linhas:");
    asciiLines.forEach((linha, index) => {
      if (linha.length !== LARGURA_LINHA && index < asciiLines.length - 1) { // Última linha (Last update) pode ter tamanho diferente
        console.warn(`Linha ${index + 1} tem ${linha.length} caracteres (esperado: ${LARGURA_LINHA})`);
        console.warn(`Conteúdo: "${linha}"`);
      }
    });

    // 4. Gerar GIF animado digitando linha a linha
    await generateGif(asciiLines);

    console.log("GIF gerado e salvo como retro-stats.gif");
    
    // 5. Gerar ou atualizar README.md
    await generateReadme({
      // Estatísticas dos últimos 7 dias
      totalCommits7d,
      repoMaisAtivo,
      totalPRs7d,
      totalIssues7d,
      linguagemMaisUsada,
      segundaLinguagemMaisUsada,
      terceiraLinguagemMaisUsada,
      quartaLinguagemMaisUsada,
      
      // Estatísticas gerais
      totalRepos,
      reposPublicos,
      reposPrivados,
      totalStars,
      totalForks,
      userCreatedAt,
      
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

  // Estatísticas gerais
  const totalRepos = allRepos.length;
  const reposPublicos = allRepos.filter(repo => !repo.private).length;
  const reposPrivados = allRepos.filter(repo => repo.private).length;
  
  // Buscar estatísticas do usuário
  let totalStars = 0;
  let totalForks = 0;
  
  for (const repo of allRepos) {
    totalStars += repo.stargazers_count || 0;
    totalForks += repo.forks_count || 0;
  }
  
  // Obter dados do usuário
  let userCreatedAt = 'N/A';
  try {
    const { data: userData } = await octokit.users.getByUsername({ username });
    userCreatedAt = new Date(userData.created_at).toISOString().split('T')[0]; // Formato YYYY-MM-DD
  } catch (error) {
    console.error("Erro ao obter informações do usuário:", error.message);
  }

  let totalCommits7d = 0;
  let repoMaisAtivo = 'N/A';
  let maxCommitsNoRepo = 0;

  // Para descobrir linguagens mais usadas
  const languageTotals = {};

  // 2) Para cada repositório, somar commits dos últimos 7 dias e somar linguagens
  for (const repo of allRepos) {
    const { name } = repo;

    // a) Contar commits dos últimos 7 dias nesse repositório
    try {
      const commitsCount = await countCommitsLast7Days(octokit, username, name, sinceDate);
      totalCommits7d += commitsCount;

      if (commitsCount > maxCommitsNoRepo) {
        maxCommitsNoRepo = commitsCount;
        repoMaisAtivo = name;
      }
    } catch (error) {
      console.error(`Erro ao contar commits para ${name}: ${error.message}`);
      // Continua para o próximo repositório
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
  let terceiraLinguagemMaisUsada = 'N/A';
  let quartaLinguagemMaisUsada = 'N/A';
  let maxLangValue = -1;
  let secondMaxLangValue = -1;
  let thirdMaxLangValue = -1;
  let fourthMaxLangValue = -1;
  
  // Verificar se temos dados de linguagens antes de processá-los
  if (Object.keys(languageTotals).length > 0) {
    for (const [lang, total] of Object.entries(languageTotals)) {
      if (total > maxLangValue) {
        // Deslocar todos os valores
        quartaLinguagemMaisUsada = terceiraLinguagemMaisUsada;
        fourthMaxLangValue = thirdMaxLangValue;
        
        terceiraLinguagemMaisUsada = segundaLinguagemMaisUsada;
        thirdMaxLangValue = secondMaxLangValue;
        
        segundaLinguagemMaisUsada = linguagemMaisUsada;
        secondMaxLangValue = maxLangValue;
        
        maxLangValue = total;
        linguagemMaisUsada = lang;
      } else if (total > secondMaxLangValue) {
        // Deslocar do segundo para frente
        quartaLinguagemMaisUsada = terceiraLinguagemMaisUsada;
        fourthMaxLangValue = thirdMaxLangValue;
        
        terceiraLinguagemMaisUsada = segundaLinguagemMaisUsada;
        thirdMaxLangValue = secondMaxLangValue;
        
        secondMaxLangValue = total;
        segundaLinguagemMaisUsada = lang;
      } else if (total > thirdMaxLangValue) {
        // Deslocar do terceiro para frente
        quartaLinguagemMaisUsada = terceiraLinguagemMaisUsada;
        fourthMaxLangValue = thirdMaxLangValue;
        
        thirdMaxLangValue = total;
        terceiraLinguagemMaisUsada = lang;
      } else if (total > fourthMaxLangValue) {
        // Atualizar apenas o quarto
        fourthMaxLangValue = total;
        quartaLinguagemMaisUsada = lang;
      }
    }
  } else {
    console.warn("Nenhuma informação de linguagem encontrada!");
  }

  // 4) Contar PRs e issues criadas nos últimos 7 dias
  const totalPRs7d = await countPRsLast7Days(octokit, username, sevenDaysAgo);
  const totalIssues7d = await countIssuesLast7Days(octokit, username, sevenDaysAgo);

  return {
    // Estatísticas dos últimos 7 dias
    totalCommits7d,
    repoMaisAtivo,
    totalPRs7d,
    totalIssues7d,
    linguagemMaisUsada,
    segundaLinguagemMaisUsada,
    terceiraLinguagemMaisUsada,
    quartaLinguagemMaisUsada,
    
    // Estatísticas gerais
    totalRepos,
    reposPublicos,
    reposPrivados,
    totalStars,
    totalForks,
    userCreatedAt
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
  try {
    let page = 1;
    const perPage = 100;
    let total = 0;
    while (true) {
      try {
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
      } catch (error) {
        // Se der um erro 404, o repositório pode não existir ou estar inacessível
        if (error.status === 404) {
          console.warn(`Repositório não encontrado ou inacessível: ${owner}/${repo}`);
          return 0; // Retorna 0 commits para este repositório
        }
        throw error; // Re-lança outros tipos de erro
      }
    }
    return total;
  } catch (error) {
    console.warn(`Erro ao contar commits para ${owner}/${repo}: ${error.message}`);
    return 0; // Retorna 0 commits em caso de erro
  }
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
  const WIDTH = 900;
  const HEIGHT = 900;
  const LINE_DURATION = 500; // Meio segundo (500ms) para completar cada linha
  const END_DELAY = 3000;    // 3 segundos no final da animação

  const encoder = new GIFEncoder(WIDTH, HEIGHT);
  const outputFile = path.join(__dirname, '..', 'retro-stats.gif');
  const writeStream = fs.createWriteStream(outputFile);

  encoder.createReadStream().pipe(writeStream);
  encoder.start();
  encoder.setRepeat(0);   // 0 = loop infinito
  encoder.setQuality(4);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.font = '16px monospace';

  // Simular digitação
  const typedLines = asciiLines.map(() => '');
  for (let i = 0; i < asciiLines.length; i++) {
    const fullLine = asciiLines[i];
    const charsInLine = fullLine.length;
    // Calcula o delay necessário para que a linha complete em 500ms
    const charDelay = Math.floor(LINE_DURATION / charsInLine);
    
    encoder.setDelay(charDelay);
    
    for (let j = 0; j < fullLine.length; j++) {
      typedLines[i] += fullLine[j];
      drawFrame(ctx, typedLines, WIDTH, HEIGHT);
      encoder.addFrame(ctx);
    }
    
    // Pequena pausa ao final de cada linha
    encoder.setDelay(100);
    drawFrame(ctx, typedLines, WIDTH, HEIGHT);
    encoder.addFrame(ctx);
  }

  // Pausa final
  encoder.setDelay(END_DELAY);
  drawFrame(ctx, typedLines, WIDTH, HEIGHT);
  encoder.addFrame(ctx);

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
    // Estatísticas dos últimos 7 dias
    totalCommits7d,
    repoMaisAtivo,
    totalPRs7d,
    totalIssues7d,
    linguagemMaisUsada,
    segundaLinguagemMaisUsada,
    terceiraLinguagemMaisUsada,
    quartaLinguagemMaisUsada,
    
    // Estatísticas gerais
    totalRepos,
    reposPublicos,
    reposPrivados,
    totalStars,
    totalForks,
    userCreatedAt,
    
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
- **Repositório mais ativo:** ${repoMaisAtivo}

## Estatísticas Gerais
- **Total de repositórios:** ${totalRepos}
- **Repositórios públicos:** ${reposPublicos}
- **Repositórios privados:** ${reposPrivados}
- **Total de stars:** ${totalStars}
- **Total de forks:** ${totalForks}
- **Conta criada em:** ${userCreatedAt}

## Linguagens Mais Usadas
- **Linguagem mais usada:** ${linguagemMaisUsada}
- **Segunda linguagem mais usada:** ${segundaLinguagemMaisUsada}
- **Terceira linguagem mais usada:** ${terceiraLinguagemMaisUsada}
- **Quarta linguagem mais usada:** ${quartaLinguagemMaisUsada}

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
