import _ from 'lodash'
import dayjs from 'dayjs'
import { parseAsync } from 'json2csv'
import { saveAs } from 'file-saver'

import { m2ToHa } from './utils'
import { emission_model } from './emission_model'

export const loadLocationsData = async ({
  type = 'country', // country, aoi, wdpa
}) => {
  const dataUrl = `/geojson/${type}_locations.json`
  console.log('Loading locations data')
  // await delay(1000)
  const data = await fetch(dataUrl).then((res) => res.json())
  return data
}

export const loadSingleLocationData = async (locationID) => {
  console.log(`Loading location ${locationID} data`)
  const dataUrl = `/locations_data/${locationID}.json`
  const data = fetch(dataUrl).then((res) => res.json())
  // await delay(1000)
  return data
}

export function parseLocationData({
  locationData,
  historicalDates = ['1996-01-01', '2016-01-01'],
}) {
  // Mg (Megagram) == Tonne
  const { mangrove_datum } = locationData

  // get data for each historical date
  const historicalTimeDiff = dayjs(historicalDates[1]).diff(
    dayjs(historicalDates[0]),
    'year'
  )
  const historicalDatapoints = [
    mangrove_datum.find(({ date }) => date === historicalDates[0]),
    mangrove_datum.find(({ date }) => date === historicalDates[1]),
  ]

  // Area
  const { area_m2: initial_area_m2 } = historicalDatapoints[0]
  const { area_m2: current_area_m2 } = historicalDatapoints[1]
  const loss_m2 = initial_area_m2 - current_area_m2
  const loss_ha = m2ToHa(loss_m2)
  // const initial_area_ha = m2ToHa(initial_area_m2)
  const current_area_ha = m2ToHa(current_area_m2)

  // get current stored carbon
  const {
    agb_tco2e, // above ground total CO2e tonnes
    bgb_tco2e, // below ground total CO2e tonnes
    toc_tco2e, // tonnes CO2e total
    soc_tco2e,
  } = historicalDatapoints[1]

  // Calculate deforestation rate

  // deforestation rate LOG
  // (log(area[1] / area[0]) / timeDiff) * -1
  const deforestationRate =
    (Math.log(current_area_m2 / initial_area_m2) / historicalTimeDiff) * -1
  // const deforestationRatePercent = (Math.exp(deforestationRate) - 1) * 100

  // const defRate = Math.log1p(deforestationRatePercent / 100)

  // Carbon storage
  // tonnes CO2e per hectare
  // C02 is 3.67 times heavier than C
  const carbonStoredPerHectare = toc_tco2e / current_area_ha

  // Calculate remaining parameters
  const emissionsFactor = 0.8
  // sequestrationRate: varies, no global value, using 6.49 found in table S4 supp materials
  // sequestrationRate unit: tonnes CO2e per year
  const sequestrationRate = 6.49

  return {
    historicalTimeDiff,
    current_area_ha,
    loss_ha,
    deforestationRate,
    // deforestationRatePercent,
    emissionsFactor,
    sequestrationRate,
    agb_tco2e, // above ground total CO2e grams
    bgb_tco2e, // below ground total CO2e grams
    toc_tco2e, // total C02e
    soc_tco2e,
    carbonStoredPerHectare,
  }
}

export function calculateEmissionData({
  current_area_ha,
  deforestationRate,
  carbonStoredPerHectare,
  emissionsFactor = 0.8,
  // sequestrationRate: varies, no global value, using 6.49 found in table S4 supp materials
  // sequestrationRate unit: tonnes CO2e per year
  sequestrationRate = 6.49,
  forecastYears = 50,
}) {
  // generate emission_model data for range of years
  const maxDataPoints = 100
  const step = forecastYears > maxDataPoints ? forecastYears / maxDataPoints : 1
  const years = _.range(1, forecastYears + 1, step)

  const Cmax = emissionsFactor * carbonStoredPerHectare

  // output unit: tonnes CO2 emitted
  const results = years.map((year) =>
    emission_model({
      t: year,
      A1: current_area_ha, // ha
      d: deforestationRate,
      Cmax,
      s: sequestrationRate,
    })
  )

  return results
}

export function emissionModelSeriesReducer({
  seriesResults,
  forecastStartingYear,
  conversionRate = 1,
}) {
  const reducer = (acc, results, seriesIndex) => {
    const parsedResults = results.map((value, yearIndex) => ({
      name: yearIndex + forecastStartingYear, // year
      [`series_${seriesIndex}`]: value * conversionRate,
    }))

    acc = parsedResults.map((results) => {
      let match = acc.find(({ name }) => name === results.name) || {}
      match = { ...match, ...results }
      return match
    })

    return acc
  }
  return seriesResults.reduce(reducer, [])
}

export async function exportCsv({
  data,
  filename = `${new Date()}.csv`,
  options = {},
}) {
  const csv = await parseAsync(data, options)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  saveAs(blob, filename)
}
