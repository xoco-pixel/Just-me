set -e
B=http://127.0.0.1:3000
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }

echo "=== 1. Register two real accounts ==="
A=$(curl -s -X POST $B/api/auth/register); BTOK=$(echo "$A" | j "['token']"); AID=$(echo "$A" | j "['userId']")
echo "Account A: $(echo "$A" | j "['qsId']")"

curl -s -X PUT $B/api/profile -H "Content-Type: application/json" -H "Authorization: Bearer $BTOK" \
 -d '{"displayName":"Alex","dateOfBirth":"1999-04-12","gender":"man","country":"NG","city":"Port Harcourt","bio":"Music, tech and long walks.","interests":["music","gaming","technology","travel","food"],"languages":["english","pidgin"],"intentions":["dating","friendship"]}' > /dev/null
echo "Profile A saved."

C=$(curl -s -X POST $B/api/auth/register); CTOK=$(echo "$C" | j "['token']"); CID=$(echo "$C" | j "['userId']")
echo "Account B: $(echo "$C" | j "['qsId']")"
curl -s -X PUT $B/api/profile -H "Content-Type: application/json" -H "Authorization: Bearer $CTOK" \
 -d '{"displayName":"Sam","dateOfBirth":"2001-08-20","gender":"woman","country":"NG","city":"Lagos","bio":"Gaming, movies and good food.","interests":["music","gaming","movies","food","photography"],"languages":["english"],"intentions":["dating","friendship"]}' > /dev/null
echo "Profile B saved."

echo "=== 2. B sets preferences (worldwide, 22-32) ==="
curl -s -X PUT $B/api/preferences -H "Content-Type: application/json" -H "Authorization: Bearer $CTOK" \
 -d '{"ageMin":22,"ageMax":32,"genders":["man"],"searchMode":"worldwide","intentions":["dating","friendship"]}' | j "['searchDescription']"

echo "=== 3. A runs FIND MY MATCH ==="
FIND=$(curl -s -X POST $B/api/matches/find -H "Authorization: Bearer $BTOK")
echo "results: $(echo "$FIND" | j "['count']")   scanned: $(echo "$FIND" | j "['diagnostics']['profilesConsidered']")"
echo "$FIND" | python3 -c "
import sys,json; d=json.load(sys.stdin)
for r in d['results'][:3]:
    print(f\"  {r['profile']['displayName']} ({r['profile']['age']}, {r['profile']['countryName']}) -> {r['score']}%\")
    for reason in r['reasons'][:3]: print('     -', reason['text'])
"

TARGET=$(echo "$FIND" | python3 -c "
import sys,json; d=json.load(sys.stdin)
m=[r for r in d['results'] if r['profile']['displayName']=='Sam']
print(m[0]['userId'] if m else '')")
echo "Target (Sam) userId: $TARGET"

echo "=== 4. Mutual match ==="
echo "A likes B: $(curl -s -X POST $B/api/matches/$TARGET/action -H "Content-Type: application/json" -H "Authorization: Bearer $BTOK" -d '{"action":"like"}' | j "['status']")"
FIND2=$(curl -s -X POST $B/api/matches/find -H "Authorization: Bearer $CTOK")
BACK=$(echo "$FIND2" | python3 -c "
import sys,json; d=json.load(sys.stdin)
m=[r for r in d['results'] if r['profile']['displayName']=='Alex']
print(m[0]['userId'] if m else '')")
echo "B likes A: $(curl -s -X POST $B/api/matches/$BACK/action -H "Content-Type: application/json" -H "Authorization: Bearer $CTOK" -d '{"action":"like"}' | j "['mutual']") (mutual)"

echo "=== 5. Contact exchange: consent gate ==="
echo "Request without contact method: $(curl -s -X POST $B/api/exchange/request -H "Content-Type: application/json" -H "Authorization: Bearer $BTOK" -d "{\"recipientId\":\"$TARGET\"}" | j "['error']['details']['code']")"
curl -s -X POST $B/api/profile/contact-methods -H "Content-Type: application/json" -H "Authorization: Bearer $BTOK" -d '{"type":"whatsapp","value":"+2348011112222","shareable":true}' > /dev/null
curl -s -X POST $B/api/profile/contact-methods -H "Content-Type: application/json" -H "Authorization: Bearer $CTOK" -d '{"type":"instagram","value":"@sam_real","shareable":true}' > /dev/null
EXID=$(curl -s -X POST $B/api/exchange/request -H "Content-Type: application/json" -H "Authorization: Bearer $BTOK" -d "{\"recipientId\":\"$TARGET\"}" | j "['id']")
echo "Exchange created: $EXID"
echo -n "A reads details BEFORE B accepts -> HTTP "
curl -s -o /dev/null -w "%{http_code}\n" $B/api/exchange/$EXID/details -H "Authorization: Bearer $BTOK"
echo -n "B accepts -> "
curl -s -X POST $B/api/exchange/$EXID/respond -H "Content-Type: application/json" -H "Authorization: Bearer $CTOK" -d '{"action":"accept"}' | j "['status']"
echo "A reads details AFTER mutual consent:"
curl -s $B/api/exchange/$EXID/details -H "Authorization: Bearer $BTOK" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  ',d['otherName'],'->',[m['value'] for m in d['contactMethods']])"

echo "=== 6. Notifications (real events only) ==="
curl -s $B/api/notifications -H "Authorization: Bearer $CTOK" | python3 -c "
import sys,json;d=json.load(sys.stdin)
for n in d['notifications'][:5]: print('  ',n['type'],'|',n['title'])"
