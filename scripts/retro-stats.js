#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function getGitHubData() {
  const username = "hcelante";
  
  const repos = await octokit.repos.listForUser({
    username,
    per_page: 100,
    sort: "updated",
  });

  const repoMaisAtivo = repos.data[0].name;

  return {
    commitsSemana: 23,
    prsSemana: 2,
    issuesSemana: 1,
    linguagemMaisUsada: "JavaScript",
    repoMaisAtivo,
  };
}

function gerarPainelRetro(dados) {
  const { commitsSemana, prsSemana, issuesSemana, linguagemMaisUsada, repoMaisAtivo } = dados;
  const dataAtual = new Date().toISOString().replace("T", " ").split(".")[0] + " UTC";

  return `
┌─────────────────────────────────────┐
│            Hcelante Stats           │
├─────────────────────────────────────┤
│ Commits (últimos 7 dias):   ${commitsSemana.toString().padEnd(3," ")}     │
│ PRs criadas (últimos 7 dias): ${prsSemana.toString().padEnd(3," ")}       │
│ Issues abertas (últimos 7 dias):${issuesSemana.toString().padEnd(3," ")}  │
├─────────────────────────────────────┤
│ Linguagem + usada: ${linguagemMaisUsada.padEnd(14," ")}       │
│ Repositório + ativo: ${repoMaisAtivo.padEnd(14," ")}          │
└─────────────────────────────────────┘
 Last update: ${dataAtual}
`.trim();
}

(async () => {
  try {
    const dados = await getGitHubData();
    const painel = gerarPainelRetro(dados);

    const outputPath = path.join(__dirname, "..", "retro-stats.md");
    fs.writeFileSync(outputPath, "```\n" + painel + "\n```\n");
    console.log("Arquivo retro-stats.md atualizado com sucesso!");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
