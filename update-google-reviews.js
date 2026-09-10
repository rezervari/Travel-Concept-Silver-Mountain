/**
 * update-google-reviews.js
 * Regenerează secțiunea "google" din reviews.json folosind Google Places API (New).
 *
 * Cerințe:
 *  - Node.js 18+ (fetch nativ)
 *  - Variabilă de mediu GOOGLE_PLACES_API_KEY (NU hardcodata în cod)
 *  - API "Places API (New)" activat în Google Cloud Console, cu key restricționat la acest API
 *
 * Rulare locală:
 *   set GOOGLE_PLACES_API_KEY=xxxxx   (Windows CMD)
 *   $env:GOOGLE_PLACES_API_KEY="xxxxx"  (PowerShell)
 *   node update-google-reviews.js
 *
 * Notă: Places API (New) returnează maxim 5 recenzii per locație (limitare Google, nu a
 * scriptului). Recenziile Booking/Airbnb din reviews.json NU sunt atinse de acest script —
 * se adaugă/actualizează manual în același fișier.
 */
"use strict";

var fs = require("fs");
var path = require("path");

var PLACE_ID = "ChIJF2VRokJFs0ARyQl2NfVA3hw"; // Travel Concept - Silver Mountain
var REVIEWS_FILE = path.join(__dirname, "reviews.json");
var API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if(!API_KEY){
  console.error("EROARE: variabila de mediu GOOGLE_PLACES_API_KEY nu este setată.");
  process.exit(1);
}

function loadExistingReviews(){
  try{
    var raw = fs.readFileSync(REVIEWS_FILE, "utf8");
    return JSON.parse(raw);
  }catch(e){
    console.warn("Nu am găsit reviews.json existent, creez unul nou.");
    return {
      updatedAt: null,
      placeId: PLACE_ID,
      platforms: {
        google: { label:"Google", url:"", rating:0, totalReviews:0, scaleMax:5 },
        booking: { label:"Booking.com", url:"", rating:0, totalReviews:0, scaleMax:10 },
        airbnb: { label:"Airbnb", url:"", rating:0, totalReviews:0, scaleMax:5 }
      },
      reviews: []
    };
  }
}

function fetchGooglePlaceDetails(){
  var url = "https://places.googleapis.com/v1/places/" + PLACE_ID + "?languageCode=ro&reviewsSort=newest";
  return fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,googleMapsUri,reviews"
    }
  }).then(function(res){
    if(!res.ok){
      return res.text().then(function(txt){
        throw new Error("Places API a răspuns " + res.status + ": " + txt);
      });
    }
    return res.json();
  });
}

function mapGoogleReview(r){
  // r.rating: 1-5 | r.text.text: continut | r.publishTime: ISO | r.authorAttribution.displayName
  return {
    platform: "google",
    author: (r.authorAttribution && r.authorAttribution.displayName) || "Oaspete Google",
    rating: r.rating || 5,
    date: r.publishTime ? r.publishTime.slice(0,10) : new Date().toISOString().slice(0,10),
    text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || ""
  };
}

fetchGooglePlaceDetails().then(function(place){
  var data = loadExistingReviews();

  data.platforms.google.rating = place.rating || data.platforms.google.rating;
  data.platforms.google.totalReviews = place.userRatingCount || data.platforms.google.totalReviews;
  data.platforms.google.url = place.googleMapsUri || data.platforms.google.url;

  var freshGoogleReviews = (place.reviews || []).map(mapGoogleReview);

  // pastreaza recenziile non-google neschimbate, inlocuieste doar blocul google
  var nonGoogle = data.reviews.filter(function(r){ return r.platform !== "google"; });
  data.reviews = nonGoogle.concat(freshGoogleReviews);
  data.updatedAt = new Date().toISOString();

  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log("reviews.json actualizat cu " + freshGoogleReviews.length + " recenzii Google (rating " + data.platforms.google.rating + ", " + data.platforms.google.totalReviews + " total).");
}).catch(function(err){
  console.error("Actualizarea recenziilor Google a eșuat:", err.message);
  process.exit(1);
});
