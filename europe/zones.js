// Label anchors are illustrative reference points within each market.
export const zones = Object.fromEntries([
 ['AT','Austria',14.2,47.5],['BE','Belgium',4.6,50.6],['BG','Bulgaria',25.3,42.6],
 ['CH','Switzerland',8.1,46.7],['CZ','Czechia',15.4,49.8],['DE-LU','Germany–Luxembourg',10.2,51.1,'DE_LU'],
 ['DK-DK1','West Denmark',9.1,56.1,'DK_1'],['DK-DK2','East Denmark',12,55.6,'DK_2'],
 ['EE','Estonia',25.7,58.7],['ES','Spain',-3.7,40.4],['FI','Finland',26,64],['FR','France',2.4,46.6],
 ['GB','Great Britain',-2.2,54.2],['GR','Greece',22.2,39.3],['HR','Croatia',16.6,45.5],['HU','Hungary',19.4,47],
 ['IT-CAL','Calabria',16.4,39.2,'IT_CALA'],['IT-CNO','Centre North Italy',11.2,43.6,'IT_CNOR'],
 ['IT-CSO','Centre South Italy',13.4,41.8,'IT_CSUD'],['IT-NO','North Italy',10.4,45.3,'IT_NORD'],
 ['IT-SAR','Sardinia',9,40,'IT_SARD'],['IT-SIC','Sicily',14,37.6,'IT_SICI'],['IT-SO','South Italy',15.9,41,'IT_SUD'],
 ['LT','Lithuania',24,55.3],['LV','Latvia',25,56.9],['NL','Netherlands',5.6,52.2],
 ['NO-NO1','East Norway',11.5,60.3,'NO_1'],['NO-NO2','South Norway',7.7,58.8,'NO_2'],
 ['NO-NO3','Central Norway',9.4,63.1,'NO_3'],['NO-NO4','North Norway',19.2,68.8,'NO_4'],['NO-NO5','West Norway',6.3,60.7,'NO_5'],
 ['PL','Poland',19.4,52],['PT','Portugal',-8.1,39.7],['RO','Romania',25,46],
 ['RS','Serbia',21,44.1],['SEM','Single Electricity Market',-7.8,53.5],
 ['SE-SE1','Luleå',21,66.8,'SE_1'],['SE-SE2','Sundsvall',16.4,63.1,'SE_2'],
 ['SE-SE3','Stockholm',15,59.4,'SE_3'],['SE-SE4','Malmö',14.2,56.3,'SE_4'],
 ['SI','Slovenia',14.8,46.1],['SK','Slovakia',19.4,48.7],
 ['AL','Albania',20,41.2],['BA','Bosnia and Herzegovina',17.8,44.2],['MK','North Macedonia',21.7,41.6],['ME','Montenegro',19.3,42.8],['XK','Kosovo',20.9,42.6],['UA','Ukraine',30.7,49],['MD','Moldova',28.5,47.2],['CY','Cyprus',33.2,35.1],['TR','Türkiye',32.8,39.2]
].map(([id,name,lon,lat,file])=>[id,{name,position:[lon,lat],file:file??id}]));
export const boundaryRoot='https://raw.githubusercontent.com/fboerman/entsoe-py/master/entsoe/geo/geojson/';
export const boundaryIds=Object.keys(zones).slice(0,42).filter(id=>!['GB','SEM'].includes(id));
export const ids={
 price:'price.day_ahead.day_ahead_auction_price',
 load:'consumption.realised_load.total_load',
 forecast:'consumption.load_forecast.day_ahead_total_load_forecast',
 fuel:'production.realised_output.actual_generation_per_type.',
 flow:'exchange.physical_flow.physical_flow'
};
export const hour=3600000; export const minute=60000;

