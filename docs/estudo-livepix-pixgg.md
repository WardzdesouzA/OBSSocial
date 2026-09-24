# Estudo: LivePix e PixGG dentro do OBS Social

Levantamento feito em setembro de 2026. **Atualização (v0.174):** a fase 1 e
a fase 2 da LivePix foram implementadas pela API oficial (`connectors/livepix.js`):
mensagens e pagamentos viram comentários da aba 💜, com controles dos alertas
(autoPlay/skip/replay), carteira, assinaturas e recompensas no painel. O que
segue é o levantamento original.

**Atualização (v0.175):** a PixGG entrou pelo canal do widget (Pusher), como
função do 🧪 Labs, **não oficial** — `connectors/pixgg.js`. O que foi feito e
por quê está na seção «PixGG — o que a v0.175 fez» no fim deste documento,
junto com o e-mail enviado à PixGG pedindo permissão.

Contexto: o objetivo é que uma doação feita nessas plataformas vire um apoio 💝
no painel, com **nome, valor e mensagem**, do mesmo jeito que o 💠 Pix direto do
banco já faz. O programa roda no PC do streamer, então **webhook não serve** —
qualquer caminho precisa funcionar por consulta periódica.

---

## LivePix — viável, API oficial e gratuita

A LivePix publica uma API REST versão 2.0.0 em <https://docs.livepix.gg/api>,
com especificação OpenAPI em <https://api.livepix.gg/open-api.json>. A própria
página de documentação afirma: *"Todos os usuários da LivePix podem utilizar a
API sem custo adicional."*

### Como o streamer liga

1. Cria uma aplicação nas configurações da conta LivePix.
2. Copia `client_id` e `client_secret`.
3. Cola nas configurações do OBS Social.

Autenticação por OAuth2 `client_credentials`:

```
POST https://oauth.livepix.gg/oauth2/token
grant_type=client_credentials&client_id=<id>&client_secret=<segredo>&scope=<permissoes>
```

Devolve `access_token` com `expires_in: 3600` e escopos
`account:read wallet:read webhooks`. Também existe o fluxo de código de
autorização, para acessar a conta de terceiros — desnecessário aqui, já que é a
própria conta do streamer.

> ⚠️ A documentação avisa que a emissão desnecessária de tokens é monitorada e
> pode encerrar a conta. O token de 1 h **tem** de ficar em cache.

### O caminho sem URL pública

`GET https://api.livepix.gg/v2/messages` lista as mensagens recebidas.
Parâmetros: `proof`, `reference`, `currency`, `page` (padrão 1), `limit`
(padrão 20, máximo 100). Cada item traz:

| campo | descrição |
|---|---|
| `id` | identificador único da mensagem |
| `username` | quem mandou |
| `message` | o texto (**máximo 32 caracteres** no schema) |
| `amount` | valor **em centavos** |
| `currency` | moeda |
| `proof` | comprovante — no Pix, o `endToEndId` |
| `createdAt` | data |

É exatamente o padrão que o 💠 já usa: consulta periódica + conjunto de vistos
por `id`, persistido para não repetir depois de reiniciar. Ver
`pixRt.vistos` / `PIX_VISTOS_FILE` em `server.js`.

Há também `GET /v2/payments` (mesma paginação) para os pagamentos sem mensagem.

### O que dá para fazer além do apoio 💝

| Endpoint | Vira o quê |
|---|---|
| `GET /v2/controls` · `PATCH /v2/controls {autoPlay}` | com `autoPlay:false` os alertas do LivePix param de sair sozinhos e ficam em fila |
| `POST /v2/controls/skip` | botão ⏭ no painel |
| `POST /v2/controls/replay` | botão 🔁 no painel |
| `GET /v2/wallet` · `GET /v2/wallet/{moeda}/receivables` · `/transactions` | saldo e recebíveis → widget de meta |
| `GET /v2/subscriptions` · `GET /v2/subscriptions/plans` | assinaturas viram categoria de apoio, como membro/sub |
| `GET /v2/rewards` · `GET /v2/rewards/{id}/grants` | recompensas |
| `POST /v2/payments` | cria uma solicitação e devolve uma URL de checkout (`checkout.livepix.gg/...`) → dá para virar QR no overlay |
| `GET /v2/account` | nome, usuário e avatar da conta, para o card de conexão |
| `GET/POST/DELETE /v2/webhooks` | gerenciar webhooks pela API — não precisamos, já que consultamos |

Os controles de alerta são o achado mais interessante: encaixam direto na fila
📌, no destaque e no 🎛️ Controle externo que já existem.

### Limites a respeitar

- Rate limit por endpoint, reiniciado a cada minuto; o teto de cada um vem no
  header `X-RateLimit-Limit` da resposta. Estourar devolve `HTTP 429`.
- Mensagem de 32 caracteres — o cartão de destaque precisa aguentar bem um texto
  curto (já aguenta).
- A taxa que a LivePix cobra sobre a doação é o modelo de negócio deles e não
  muda com a integração. Não foi verificada neste estudo.

---

## PixGG — não há caminho equivalente

Não foi encontrada API pública nem documentação para desenvolvedores.

- O site é um SPA (Vue/Nuxt); `api.pixgg.com` devolve o HTML da aplicação para
  qualquer caminho testado (`/docs`, `/swagger`, `/openapi.json`, `/api-docs`,
  `/v1`, `/redoc` — todos 200 com a mesma página, o que é o catch-all do SPA, não
  um endpoint).
- Os endpoints que aparecem no bundle são de funcionalidades do produto
  (`/goals/`, `/jointgoals/`, `/pixathon/`, `/songpix/`), não de integração.
- O tempo real do widget de alerta roda em **Pusher** (`js.pusher.com/7.2`).

### Três saídas, em ordem de preferência

1. **Pedir acesso a eles.** É a única que chega ao nível do LivePix. Eles têm
   página de integração, então provavelmente há algo para parceiros.
2. **Embutir o widget de alerta deles como camada do nosso overlay.** Legítimo —
   é o que o OBS já faz com a URL do widget — e barato. O alerta aparece na live
   com a arte do PixGG, mas **não alimenta o painel**: sem nome, valor e mensagem
   nos apoios.
3. **Ler o Pusher do widget por engenharia reversa.** Desaconselhado: é API
   privada, quebra sem aviso e provavelmente fere os termos de uso.

---

## Fatiamento sugerido, se for retomar

- **Fase 1** — 💜 LivePix no 🧪 Labs: `client_id`/`client_secret` num card de
  conexão nos moldes do Telegram/WhatsApp (três cores, segredo cifrado com
  `guardarSegredo`, credencial lembrada entre sessões), consulta periódica de
  `/v2/messages`, cada mensagem vira apoio 💝 pelo mesmo caminho que o Pix já usa
  (`Doacao vinda de fora` em `server.js`).
- **Fase 2** — controles do alerta no painel (⏭ 🔁 e o interruptor de fila) e as
  ações correspondentes no 🎛️ Controle externo.
- **Fase 3** — carteira/metas e assinaturas.
- **PixGG** — fase 0 barata: camada de widget no overlay; em paralelo, pedir a
  API a eles.

---

## PixGG — o que a v0.175 fez

Sem API pública e sem resposta a um pedido de acesso (a página de contato é a
única porta), a saída 3 foi implementada — com todos os cuidados que dá para
ter quando se usa um mecanismo interno de outra empresa:

**O que o conector faz.** O widget de alertas da PixGG (`api.pixgg.com/?apikey=…`)
abre uma conexão com o Pusher (app público do widget, cluster `mt1`) e assina um
canal **público** cujo nome é a própria chave do streamer — não há autenticação
extra. Por esse canal chegam os eventos `messages` (a doação: id da transação,
apelido, mensagem, valor, moeda, link do áudio, vídeo pedido…), `pause`,
`skip-alert` e `clear-queue` (os comandos que o painel da PixGG manda ao
widget). O conector do OBS Social assina o mesmo canal, com uma conexão só, e
**apenas lê**: não chama nenhum endpoint HTTP da PixGG (nem o que marca a
mensagem como lida), não dispara nada, não escreve nada. É o mesmo tráfego de
um widget aberto numa fonte de navegador. O áudio da mensagem é baixado do link
público que a própria PixGG entrega, para a quarentena local de mídia.

**Por que Labs e quatro avisos.** Foi descoberto por engenharia reversa do
bundle do widget, pode mudar sem aviso, e os termos da PixGG — que não falam de
API nem de automação — reservam o direito de encerrar contas que «prejudiquem a
integridade do serviço». O streamer precisa saber disso antes de ligar. Por
isso a função começa desligada e o servidor só aceita conectar com o seletor do
Labs ligado **e** os quatro avisos marcados (não oficial e pode quebrar; o risco
perante os termos é do streamer; o público será avisado — há um texto sugerido;
a permissão foi pedida e a função será removida se a PixGG discordar). Desmarcar
qualquer aviso, ou desligar o Labs, derruba a conexão e esquece a chave.

**Segurança.** A chave do widget é o segredo da conexão: fica cifrada em
`data/connections.json` (AES-256-GCM, chave local), nunca vai para as telas nem
para a rede (`conexoesPublicas` só diz `temToken`), e o «canal» lembrado é
sempre o texto fixo `pixgg`.

**O pedido de permissão.** Junto com a versão, foi enviado um e-mail a
contato@pixgg.com explicando exatamente o que está acima, com o endereço do
projeto (https://github.com/WardzdesouzA/OBSSocial), pedindo permissão ou uma
API oficial, e se comprometendo a retirar a integração se a PixGG preferir. Se
a resposta vier com uma API, `connectors/pixgg.js` é trocado e o painel não
muda.
