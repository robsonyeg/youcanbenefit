import { Injectable } from '@nestjs/common';
import { KeyDto } from './key.dto';
import { Client } from "elasticsearch";
import { ClientService } from "../db.elasticsearch/client.service"
import { Observable } from "rxjs/Observable";
import "rxjs/add/observable/fromPromise";
import "rxjs/add/operator/pluck";
import "rxjs/add/operator/map";
import "rxjs/add/operator/reduce";
import { create } from 'domain';
import { Schema } from '../data/schema'


@Injectable()
export class KeyService {
    private client: Client;
    private readonly baseParams = {
        index: "master_screener",
        type: "queries"
    };

    constructor(private readonly clientService: ClientService) {
        this.client = this.clientService.client;
    }

    create(key: KeyDto): Promise<any> {
        return this.client.indices.putMapping({
            ...this.baseParams,
            body: {
                properties: {
                    [key.name]: {
                        type: key['type']
                    }
                }
            }
        })
            .then(res => res.acknowledged )
            .catch(err => {
                return {
                    "error": "key messed up"
                }
            })
    }


    private uploadQueries(queries): Promise<any> {
        const _queries = this.uploadQueriesWithOverwrite(queries);
        return Promise.all(_queries)
    }

    private uploadQueriesWithOverwrite(queries): Promise<any>[] {
        return  queries.map( (query, i) => this.client.index( {
                    index: "master_screener",
                    type: "queries",
                    id: query['meta'].id,
                    body: {
                        query: query['query'],
                        meta: query['meta']
                    }
            }).catch(err => {
                console.log("\x1b[31m", 'ERROR: uploading queries');
                console.log(err);
                process.exit(102);
                return new Error(err)
            })
        )
    }


    async updateAll(keys: KeyDto[]) : Promise<any> {
        const indexExists = await this.client.indices.exists({ index:'master_screener' });

        const queriesRequest = await this.client.search({
            index: Schema.queries.index,
            type: Schema.queries.type,
            size: 10000,
            body: { query: { match_all: {} } }
        })

        const queries = queriesRequest.hits.hits.map(h => h._source)

        if (indexExists) {
            await this.client.indices.delete({ index:'master_screener' })
        }

        const mapping = []

        keys.forEach( key => {
            mapping.push({[key.name] : {type: key.type}})
        })
        console.log(mapping)

        const normalizedMapping = mapping.reduce( (result, item) => {
            var key = Object.keys(item)[0]
            result[key] = item[key]
            return result
        }, {});

        console.log(normalizedMapping);



        await this.client.indices.create({ index: 'master_screener'});
        const masterScreenerPutMapping = await this.client.indices.putMapping({
            index: Schema.queries.index,
            type: Schema.queries.type,
            body: { properties: { ...normalizedMapping } }
        });

        const queryRes = await this.uploadQueries(queries)


        return {masterScreenerPutMapping, queryRes}
    }

    findAll(): Observable<any> {
        return Observable.fromPromise(this.client.indices.getMapping({
            ...this.baseParams
        }))
            .pluck('master_screener', 'mappings', 'queries', 'properties')
            .map(keyObj => {
                delete keyObj['meta'];
                delete keyObj['query'];
                return keyObj
            })
            .map(obj => {
                const array = [];

                for(const name in obj) {
                    if (obj.hasOwnProperty(name)) {
                        array.push({
                            name,
                            type: obj[name].type
                        })
                    }
                }

                return array
            })
    }

}