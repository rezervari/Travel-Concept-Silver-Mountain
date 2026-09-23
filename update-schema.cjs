"use strict";
/**
 * update-schema.cjs
 *
 * Citește reviews.json și regenerează câmpurile "aggregateRating" și "review"
 * din obiectul LodgingBusiness al JSON-LD-ului din index.html.
 *
 * Nu atinge nimic altceva din JSON-LD (name, address, sameAs, makesOffer etc.
 * rămân cele scrise manual) -- singura responsabilitate a scriptului e sincronizarea
 * ratingului si a recenziilor cu reviews.json, ca sa nu ramana date invechite/inexacte
 * in structured data (Google penalizeaza discrepantele intre schema si continutul real).
 *
 * aggregateRating foloseste rating-ul agregat de pe Google (reviews.json -> platforms.google),
 * pentru ca e aceeasi cifra vizibila si pe profilul Google Business legat prin "sameAs" --
 * evita orice cifra "combinata" care nu se regaseste identic nicaieri altundeva.
 *
 * review: cate un nod Review pentru fiecare recenzie din reviews.json (Google + Booking + Airbnb),
 * generat mecanic -- nu curatat manual -- ca sa respecte cerinta Google de reprezentativitate
 * (nu doar recenziile bune). Plafonat la ultimele MAX_REVIEWS ca sa nu creasca nelimitat fisierul.
 *
 * Rulare manuală:  node update-schema.cjs
 * Rulare automată: .github/workflows/update-schema.yml (la push pe reviews.json)
 */

const fs = require("fs");
const path = require("path");

const REVIEWS_JSON = path.join(__dirname, "reviews.json");
const INDEX_HTML = path.join(__dirname, "index.html");
const MAX_REVIEWS = 30; // cele mai recente N recenzii intra in schema; restul raman doar afisate pe site din reviews.json

const PLATFORM_META = {
  google:  { scale: 5,  label: "Google" },
  booking: { scale: 10, label: "Booking.com" },
  airbnb:  { scale: 5,  label: "Airbnb" }
};

function main(){
  if(!fs.existsSync(REVIEWS_JSON)){
    throw new Error("Nu găsesc reviews.json la rădăcina proiectului: " + REVIEWS_JSON);
  }
  if(!fs.existsSync(INDEX_HTML)){
    throw new Error("Nu găsesc index.html la rădăcina proiectului: " + INDEX_HTML);
  }

  var reviewsData = JSON.parse(fs.readFileSync(REVIEWS_JSON, "utf8"));
  var platforms = reviewsData.platforms || {};
  var allReviews = reviewsData.reviews || [];

  var google = platforms.google;
  if(!google || !google.rating || !google.totalReviews){
    throw new Error('reviews.json nu are date valide pentru "platforms.google" (rating + totalReviews). Nu pot genera aggregateRating.');
  }

  var html = fs.readFileSync(INDEX_HTML, "utf8");

  var scriptRe = /(<script type="application\/ld\+json">\s*)([\s\S]*?)(\s*<\/script>)/;
  var match = scriptRe.exec(html);
  if(!match){
    throw new Error('Nu găsesc blocul <script type="application/ld+json"> în index.html.');
  }

  var jsonLd;
  try{
    jsonLd = JSON.parse(match[2]);
  } catch(e){
    throw new Error("JSON-LD-ul existent din index.html nu e JSON valid: " + e.message);
  }

  var graph = jsonLd["@graph"] || [];
  var lodging = graph.find(function(node){ return node["@type"] === "LodgingBusiness"; });
  if(!lodging){
    throw new Error('Nu găsesc nodul "LodgingBusiness" în @graph-ul JSON-LD.');
  }

  // aggregateRating -- din rating-ul Google (acelasi vizibil pe profilul GBP legat prin sameAs)
  lodging.aggregateRating = {
    "@type": "AggregateRating",
    "ratingValue": google.rating,
    "reviewCount": google.totalReviews,
    "bestRating": google.scaleMax || PLATFORM_META.google.scale,
    "worstRating": 1
  };

  // review -- cate un nod pentru fiecare recenzie (toate platformele), cele mai recente MAX_REVIEWS
  var sorted = allReviews.slice().sort(function(a,b){
    return new Date(b.date || 0) - new Date(a.date || 0);
  });
  var picked = sorted.slice(0, MAX_REVIEWS);

  lodging.review = picked.map(function(r){
    var meta = PLATFORM_META[r.platform] || { scale: 5, label: r.platform };
    var scaleMax = (platforms[r.platform] && platforms[r.platform].scaleMax) || meta.scale;
    var node = {
      "@type": "Review",
      "author": { "@type": "Person", "name": r.author || "Oaspete" },
      "reviewBody": r.text || "",
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": r.rating,
        "bestRating": scaleMax,
        "worstRating": 1
      },
      "publisher": { "@type": "Organization", "name": meta.label }
    };
    if(r.date) node.datePublished = r.date;
    return node;
  });

  var newJsonText = JSON.stringify(jsonLd, null, 2);
  var newHtml = html.slice(0, match.index) + match[1] + newJsonText + match[3] + html.slice(match.index + match[0].length);

  fs.writeFileSync(INDEX_HTML, newHtml, "utf8");
  console.log("index.html actualizat — aggregateRating: " + google.rating + "/" + (google.scaleMax || PLATFORM_META.google.scale) +
    " (" + google.totalReviews + " recenzii Google) · " + picked.length + " noduri Review incluse (din " + allReviews.length + " total).");
}

main();
