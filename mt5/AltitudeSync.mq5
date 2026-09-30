//+------------------------------------------------------------------+
//|                                               AltitudeSync.mq5   |
//|        ALTITUDE Trade · BOSCOFX — synchronisation du journal     |
//|                                                                  |
//|  CET EXPERT ADVISOR NE PASSE, NE MODIFIE ET NE FERME AUCUN ORDRE.|
//|  Il lit l'historique du compte et envoie chaque position         |
//|  clôturée à votre journal ALTITUDE Trade (lecture seule).        |
//|                                                                  |
//|  Installation : voir docs/MT5-SYNC.md                            |
//+------------------------------------------------------------------+
#property copyright   "ALTITUDE Trade · BOSCOFX"
#property link        "https://altitudetrad.com"
#property version     "1.00"
#property description "Envoie automatiquement vos positions clôturées vers ALTITUDE Trade."
#property description "Lecture seule : aucun ordre n'est passé, modifié ou fermé."

//--- Paramètres (à remplir une seule fois)
input string InpEndpoint     = "https://VOTRE-PROJET.supabase.co/functions/v1/mt5-ingest"; // URL de synchronisation (copiée depuis ALTITUDE)
input string InpToken        = "";   // Jeton de synchronisation (copié depuis ALTITUDE)
input int    InpBackfillDays = 0;    // Historique à envoyer au 1er lancement (jours, 0 = à partir de maintenant)
input int    InpTimerSeconds = 15;   // Fréquence de vérification (secondes)

#define ALT_VERSION   "1.00"
#define ALT_BATCH     40
#define ALT_HEARTBEAT 300

struct AltPosition
  {
   ulong    id;
   datetime closeServer;
   string   json;
  };

bool     g_pending      = true;
datetime g_lastHeartbeat = 0;
datetime g_lastOk        = 0;
int      g_sentTotal     = 0;
string   g_status        = "Démarrage…";
string   g_gvKey         = "";

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpToken) < 24)
     {
      Alert("ALTITUDE Sync : collez votre jeton de synchronisation (ALTITUDE > Paramètres > Connexion MT5).");
      return(INIT_PARAMETERS_INCORRECT);
     }
   if(StringFind(InpEndpoint, "https://") != 0 || StringFind(InpEndpoint, "VOTRE-PROJET") >= 0)
     {
      Alert("ALTITUDE Sync : collez l'URL de synchronisation affichée dans ALTITUDE.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   g_gvKey = "ALTSYNC_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   long backfillStart = (long)TimeCurrent() - (long)MathMax(0, InpBackfillDays) * 86400;
   // 1er lancement : on part de maintenant (ou de l'historique demandé).
   // Relance avec InpBackfillDays > 0 : on renvoie ces jours-là (les doublons sont ignorés côté serveur).
   if(!GlobalVariableCheck(g_gvKey) || (InpBackfillDays > 0 && (long)GlobalVariableGet(g_gvKey) > backfillStart))
      GlobalVariableSet(g_gvKey, (double)backfillStart);
   EventSetTimer(MathMax(5, InpTimerSeconds));
   UpdateComment();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

//--- Une transaction ajoute un deal : on synchronisera au prochain tick du timer.
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
      g_pending = true;
  }

void OnTimer()
  {
   bool heartbeat = (TimeCurrent() - g_lastHeartbeat) >= ALT_HEARTBEAT;
   if(g_pending || heartbeat)
      Sync(heartbeat);
  }

//+------------------------------------------------------------------+
//| Utilitaires                                                      |
//+------------------------------------------------------------------+
int ServerOffsetSeconds()
  {
   long diff = (long)(TimeTradeServer() - TimeGMT());
   return (int)(MathRound(diff / 1800.0) * 1800);        // arrondi à 30 min
  }

string IsoUtc(datetime serverTime)
  {
   if(serverTime <= 0) return "";
   datetime utc = (datetime)((long)serverTime - ServerOffsetSeconds());
   string s = TimeToString(utc, TIME_DATE | TIME_SECONDS);  // 2026.09.28 13:05:00
   StringReplace(s, ".", "-");
   StringReplace(s, " ", "T");
   return s + "Z";
  }

string JsonEscape(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\t", " ");
   return s;
  }

string Q(string s) { return "\"" + JsonEscape(s) + "\""; }
string D(double v, int digits) { return DoubleToString(v, digits); }

string ReasonText(long reason)
  {
   switch((int)reason)
     {
      case DEAL_REASON_SL:     return "SL";
      case DEAL_REASON_TP:     return "TP";
      case DEAL_REASON_SO:     return "STOP_OUT";
      case DEAL_REASON_CLIENT: return "MANUAL";
      case DEAL_REASON_MOBILE: return "MOBILE";
      case DEAL_REASON_WEB:    return "WEB";
      case DEAL_REASON_EXPERT: return "EXPERT";
     }
   return "OTHER";
  }

void UpdateComment()
  {
   string last = g_lastOk > 0 ? TimeToString(g_lastOk, TIME_MINUTES) : "—";
   Comment("ALTITUDE Sync v", ALT_VERSION, "  ·  lecture seule\n",
           "Compte ", AccountInfoInteger(ACCOUNT_LOGIN), " · ", AccountInfoString(ACCOUNT_COMPANY), "\n",
           "Statut : ", g_status, "\n",
           "Dernière synchro : ", last, "  ·  positions envoyées : ", g_sentTotal);
  }

//+------------------------------------------------------------------+
//| Construit le JSON d'une position clôturée (false si encore ouverte)|
//+------------------------------------------------------------------+
bool BuildPosition(ulong positionId, AltPosition &out)
  {
   if(PositionSelectByTicket(positionId))
      return false;                                      // encore ouverte (sortie partielle)
   if(!HistorySelectByPosition(positionId))
      return false;

   int total = HistoryDealsTotal();
   string   symbol = "", comment = "", dealsJson = "";
   long     type = -1, magic = 0, lastReason = -1;
   ulong    openOrder = 0;
   datetime openTime = 0, closeTime = 0;
   double   volIn = 0, volOut = 0, openPriceSum = 0, closePriceSum = 0;
   double   profit = 0, commission = 0, swap = 0, fee = 0;
   double   entrySl = 0, entryTp = 0, lastSl = 0, lastTp = 0;

   for(int i = 0; i < total; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long entry    = HistoryDealGetInteger(deal, DEAL_ENTRY);
      long dealType = HistoryDealGetInteger(deal, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      double vol   = HistoryDealGetDouble(deal, DEAL_VOLUME);
      double price = HistoryDealGetDouble(deal, DEAL_PRICE);
      double p     = HistoryDealGetDouble(deal, DEAL_PROFIT);
      double c     = HistoryDealGetDouble(deal, DEAL_COMMISSION);
      double s     = HistoryDealGetDouble(deal, DEAL_SWAP);
      double f     = HistoryDealGetDouble(deal, DEAL_FEE);
      datetime t   = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
      profit += p; commission += c; swap += s; fee += f;
      if(symbol == "") symbol = HistoryDealGetString(deal, DEAL_SYMBOL);

      if(entry == DEAL_ENTRY_IN)
        {
         if(openTime == 0 || t < openTime) openTime = t;
         if(type < 0) type = dealType;
         volIn += vol; openPriceSum += price * vol;
         if(entrySl == 0) entrySl = HistoryDealGetDouble(deal, DEAL_SL);
         if(entryTp == 0) entryTp = HistoryDealGetDouble(deal, DEAL_TP);
         if(openOrder == 0) openOrder = (ulong)HistoryDealGetInteger(deal, DEAL_ORDER);
         magic = HistoryDealGetInteger(deal, DEAL_MAGIC);
         if(comment == "") comment = HistoryDealGetString(deal, DEAL_COMMENT);
        }
      else // DEAL_ENTRY_OUT, DEAL_ENTRY_OUT_BY, DEAL_ENTRY_INOUT
        {
         if(t > closeTime) closeTime = t;
         volOut += vol; closePriceSum += price * vol;
         lastSl = HistoryDealGetDouble(deal, DEAL_SL);
         lastTp = HistoryDealGetDouble(deal, DEAL_TP);
         lastReason = HistoryDealGetInteger(deal, DEAL_REASON);
         if(dealsJson != "") dealsJson += ",";
         dealsJson += "{\"time\":" + Q(IsoUtc(t)) + ",\"price\":" + D(price, 8) + ",\"volume\":" + D(vol, 4)
                      + ",\"profit\":" + D(p, 2) + ",\"commission\":" + D(c, 2) + ",\"swap\":" + D(s, 2)
                      + ",\"fee\":" + D(f, 2) + ",\"reason\":" + Q(ReasonText(HistoryDealGetInteger(deal, DEAL_REASON))) + "}";
        }
     }

   if(type < 0 || volIn <= 0 || closeTime == 0 || volOut + 1e-8 < volIn)
      return false;                                      // position incomplète

   //--- SL / TP initiaux : deal d'entrée, sinon ordre d'ouverture
   if((entrySl == 0 || entryTp == 0) && openOrder > 0 && HistoryOrderSelect(openOrder))
     {
      if(entrySl == 0) entrySl = HistoryOrderGetDouble(openOrder, ORDER_SL);
      if(entryTp == 0) entryTp = HistoryOrderGetDouble(openOrder, ORDER_TP);
     }

   double openPrice  = openPriceSum / volIn;
   double closePrice = volOut > 0 ? closePriceSum / volOut : 0;
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;

   //--- Risque réel en devise du compte : perte si le SL initial avait été touché
   double risk = 0;
   if(entrySl > 0)
     {
      SymbolSelect(symbol, true);
      double atSl = 0;
      ENUM_ORDER_TYPE ot = (type == DEAL_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(OrderCalcProfit(ot, symbol, volIn, openPrice, entrySl, atSl))
         risk = MathAbs(atSl);
     }

   double net = profit + commission + swap + fee;
   out.id = positionId;
   out.closeServer = closeTime;
   out.json = "{\"position_id\":" + Q(IntegerToString((long)positionId))
              + ",\"symbol\":" + Q(symbol)
              + ",\"type\":" + Q(type == DEAL_TYPE_BUY ? "BUY" : "SELL")
              + ",\"volume\":" + D(volIn, 4)
              + ",\"open_time\":" + Q(IsoUtc(openTime))
              + ",\"close_time\":" + Q(IsoUtc(closeTime))
              + ",\"open_price\":" + D(openPrice, digits)
              + ",\"close_price\":" + D(closePrice, digits)
              + ",\"sl\":" + D(lastSl, digits) + ",\"tp\":" + D(lastTp, digits)
              + ",\"initial_sl\":" + D(entrySl, digits) + ",\"initial_tp\":" + D(entryTp, digits)
              + ",\"risk_money\":" + D(risk, 2)
              + ",\"profit\":" + D(profit, 2) + ",\"commission\":" + D(commission, 2)
              + ",\"swap\":" + D(swap, 2) + ",\"fee\":" + D(fee, 2) + ",\"net\":" + D(net, 2)
              + ",\"close_reason\":" + Q(ReasonText(lastReason))
              + ",\"magic\":" + IntegerToString(magic)
              + ",\"comment\":" + Q(comment)
              + ",\"deals\":[" + dealsJson + "]}";
   return true;
  }

//+------------------------------------------------------------------+
string AccountJson()
  {
   return "{\"login\":" + Q(IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)))
          + ",\"server\":" + Q(AccountInfoString(ACCOUNT_SERVER))
          + ",\"company\":" + Q(AccountInfoString(ACCOUNT_COMPANY))
          + ",\"name\":" + Q(AccountInfoString(ACCOUNT_NAME))
          + ",\"currency\":" + Q(AccountInfoString(ACCOUNT_CURRENCY))
          + ",\"balance\":" + D(AccountInfoDouble(ACCOUNT_BALANCE), 2)
          + ",\"equity\":" + D(AccountInfoDouble(ACCOUNT_EQUITY), 2) + "}";
  }

//--- Envoie un lot. Retourne true si le serveur a répondu 200.
bool Post(string positionsJson)
  {
   string body = "{\"ea_version\":" + Q(ALT_VERSION) + ",\"account\":" + AccountJson() + ",\"positions\":[" + positionsJson + "]}";
   char data[], result[];
   string resultHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);                // retire le zéro final
   string headers = "Content-Type: application/json\r\nx-altitude-token: " + InpToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", InpEndpoint, headers, 15000, data, result, resultHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014)
         g_status = "URL non autorisée : Outils > Options > Expert Advisors > cochez « Autoriser WebRequest » et ajoutez l'URL Supabase.";
      else
         g_status = "Réseau indisponible (erreur " + IntegerToString(err) + "), nouvel essai automatique.";
      return false;
     }
   if(code != 200)
     {
      string answer = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      g_status = "Refusé par le serveur (" + IntegerToString(code) + ") " + StringSubstr(answer, 0, 120);
      return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Synchronisation                                                  |
//+------------------------------------------------------------------+
void Sync(bool heartbeat)
  {
   datetime since = (datetime)GlobalVariableGet(g_gvKey);
   datetime from  = (datetime)((long)since - 3600);                        // marge de sécurité
   datetime to    = (datetime)((long)TimeCurrent() + 86400);
   if(!HistorySelect(from, to))
     {
      g_status = "Historique indisponible, nouvel essai…";
      UpdateComment();
      return;
     }

   //--- 1) positions ayant un deal de sortie dans la fenêtre
   ulong ids[];
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
      ulong pid = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      bool known = false;
      for(int k = 0; k < ArraySize(ids); k++) if(ids[k] == pid) { known = true; break; }
      if(!known) { int n = ArraySize(ids); ArrayResize(ids, n + 1); ids[n] = pid; }
     }

   //--- 2) détail de chaque position (HistorySelectByPosition remplace la sélection)
   AltPosition list[];
   for(int i = 0; i < ArraySize(ids); i++)
     {
      AltPosition p;
      if(BuildPosition(ids[i], p))
        {
         int n = ArraySize(list);
         ArrayResize(list, n + 1);
         list[n] = p;
        }
     }

   //--- tri par heure de clôture
   for(int i = 1; i < ArraySize(list); i++)
     {
      AltPosition cur = list[i];
      int j = i - 1;
      while(j >= 0 && list[j].closeServer > cur.closeServer) { list[j + 1] = list[j]; j--; }
      list[j + 1] = cur;
     }

   //--- 3) envoi par lots ; on n'avance le curseur qu'après succès
   int total = ArraySize(list);
   if(total == 0)
     {
      if(heartbeat && Post(""))
        {
         g_lastHeartbeat = TimeCurrent();
         g_lastOk = TimeLocal();
         g_status = "Connecté OK";
        }
      g_pending = false;
      UpdateComment();
      return;
     }

   for(int start = 0; start < total; start += ALT_BATCH)
     {
      string batch = "";
      datetime maxClose = since;
      for(int i = start; i < MathMin(total, start + ALT_BATCH); i++)
        {
         if(batch != "") batch += ",";
         batch += list[i].json;
         if(list[i].closeServer > maxClose) maxClose = list[i].closeServer;
        }
      if(!Post(batch))
        {
         UpdateComment();
         return;                                         // g_pending reste vrai : nouvel essai
        }
      GlobalVariableSet(g_gvKey, (double)maxClose);
      g_sentTotal += MathMin(total, start + ALT_BATCH) - start;
     }
   g_pending = false;
   g_lastHeartbeat = TimeCurrent();
   g_lastOk = TimeLocal();
   g_status = "Connecté OK";
   UpdateComment();
  }
//+------------------------------------------------------------------+
