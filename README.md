# Meu Controle Financeiro — sincronizado

Site/PWA pessoal para entradas, saídas, Pix, dinheiro, cartões simplificados, limite, faturas, contas, vencimentos, gráficos e notificações.

## O que já está configurado

- Supabase conectado com a **Publishable key** do projeto (segura para uso no navegador com RLS).
- Nada de `sb_secret`, `service_role`, senha de banco ou número real de cartão no código.
- Dados locais continuam em `localStorage` como cache/offline.
- Dados da conta são sincronizados com `public.app_state` no Supabase.
- O app tenta atualizar entre aparelhos automaticamente a cada poucos segundos e também ao voltar para a tela.
- PWA com manifest, service worker e ícones para adicionar à tela inicial.

## Como usar em dois celulares

1. Publique esta pasta no GitHub Pages.
2. Abra o link no primeiro celular.
3. Crie uma conta no próprio app com e-mail e senha.
4. Se o Supabase pedir confirmação de e-mail, confirme e volte ao app.
5. No segundo celular, abra o mesmo link e **entre com o mesmo e-mail e senha**.
6. Os dois aparelhos passam a usar o mesmo conjunto de dados.

> Esta versão usa um login compartilhado porque é a forma mais simples. No futuro dá para evoluir para duas contas diferentes ligadas à mesma carteira compartilhada.

## Instalar como app

No Android/Chrome, abra o site publicado e use **Adicionar à tela inicial / Instalar app**. O app abre em modo standalone, sem precisar de APK ou Play Store.

## GitHub Pages

Suba **todos** estes arquivos e pastas para o repositório. Depois vá em:

`Settings -> Pages -> Deploy from a branch -> main / root`

O GitHub fornecerá o link público.

## Notificações

O sino dentro do app mostra avisos de contas/faturas e limite. Notificações do aparelho podem ser ativadas pelo usuário. Avisos com o site completamente fechado exigiriam push/backend adicional; esta versão não depende disso.

## Segurança

O projeto usa RLS na tabela `app_state`. A chave `sb_publishable_...` é pública por definição e pode estar no frontend. **Nunca** coloque `sb_secret_...`, `service_role`, senha do banco ou credenciais bancárias no GitHub.
